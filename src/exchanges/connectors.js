const { ethers } = require('ethers');
const config = require('../../config/config');
const tokens = require('../../config/tokens');
const web3Utils = require('../utils/web3');
const logger = web3Utils.logger;

// Exchange connector factory
class ExchangeConnectorFactory {
  static getConnector(exchange, network) {
    switch (exchange) {
      case 'uniswap':
        return new UniswapConnector(network);
      case 'sushiswap':
        return new SushiswapConnector(network);
      case 'curve':
        return new CurveConnector(network);
      case 'balancer':
        return new BalancerConnector(network);
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
}

// Base exchange connector
class BaseExchangeConnector {
  constructor(network) {
    this.network = network;
    this.provider = web3Utils.getProvider(network);
    
    try {
      this.signer = web3Utils.getSigner(network);
    } catch (error) {
      logger.warn(`No signer available for ${network}, operating in read-only mode`);
      this.signer = null;
    }
  }
  
  // Check if an exchange is supported on this network
  isSupported() {
    return true; // Override in child classes if necessary
  }
  
  createUnsignedSwapTransaction(fromToken, toToken, amount, minAmountOut) {
    throw new Error('Method not implemented');
  }

  // Get the exchange name
  getName() {
    return 'BaseExchange';
  }
  
  // Get quote for a token swap
  async getQuote(fromToken, toToken, amount) {
    throw new Error('Method not implemented');
  }
  
  // Execute a token swap
  async executeSwap(fromToken, toToken, amount, minAmountOut) {
    throw new Error('Method not implemented');
  }
}

// Uniswap connector
class UniswapConnector extends BaseExchangeConnector {
  constructor(network) {
    super(network);
    this.routerAddress = tokens.dexRouters.uniswapV3[network];
    
    // Router ABI (simplified for this example)
    this.routerABI = [
      'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)',
      'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)',
    ];
    
    // Initialize router contract
    this.router = new ethers.Contract(this.routerAddress, this.routerABI, this.provider);
    
    // If signer is available, get writable contract
    if (this.signer) {
      this.writableRouter = new ethers.Contract(this.routerAddress, this.routerABI, this.signer);
    }
  }
  
  getName() {
    return 'Uniswap';
  }
  
  isSupported() {
    return config.exchanges.uniswap.enabled && !!this.routerAddress;
  }
  
  // Get quote for a token swap
  async getQuote(fromToken, toToken, amount) {
    try {
      logger.info(`Getting Uniswap quote for ${amount} ${fromToken} to ${toToken}`);
      
      // In a real implementation, you would try multiple fee tiers
      const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
      
      let bestAmountOut = ethers.BigNumber.from(0);
      let bestFeeTier = 3000; // Default to 0.3%
      
      // Try all fee tiers to find the best rate
      for (const fee of feeTiers) {
        try {
          const amountOut = await this.router.quoteExactInputSingle(
            fromToken,
            toToken,
            fee,
            amount,
            0 // sqrtPriceLimitX96 (0 = no limit)
          );
          
          if (amountOut.gt(bestAmountOut)) {
            bestAmountOut = amountOut;
            bestFeeTier = fee;
          }
        } catch (error) {
          // This fee tier might not have liquidity, move to the next one
          logger.debug(`No liquidity for fee tier ${fee}: ${error.message}`);
        }
      }
      
      if (bestAmountOut.eq(0)) {
        throw new Error('No liquidity found on Uniswap for this token pair');
      }
      
      return {
        exchange: this.getName(),
        fromToken,
        toToken,
        inputAmount: amount,
        outputAmount: bestAmountOut,
        fee: bestFeeTier,
      };
    } catch (error) {
      logger.error(`Failed to get Uniswap quote: ${error.message}`);
      throw error;
    }
  }
  
  async createUnsignedSwapTransaction(fromToken, toToken, amount, minAmountOut, feeTier = 3000) {
    try {
      logger.info(`Creating unsigned Uniswap transaction for ${amount} ${fromToken} to ${toToken}`);
      
      // Prepare the transaction data
      const routerInterface = new ethers.utils.Interface(this.routerABI);
      const data = routerInterface.encodeFunctionData('exactInputSingle', [
        [
          fromToken, // tokenIn
          toToken, // tokenOut
          feeTier, // fee
          this.signer ? this.signer.address : ethers.constants.AddressZero, // recipient
          amount, // amountIn
          minAmountOut, // amountOutMinimum
          0, // sqrtPriceLimitX96 (0 = no limit)
        ]
      ]);
      
      // Return the unsigned transaction
      return {
        to: this.routerAddress,
        data: data,
        value: fromToken === ethers.constants.AddressZero ? amount : 0,
      };
    } catch (error) {
      logger.error(`Failed to create Uniswap transaction: ${error.message}`);
      throw error;
    }
  }

  // Execute a token swap
  async executeSwap(fromToken, toToken, amount, minAmountOut, feeTier = 3000) {
    try {
      if (!this.signer) {
        throw new Error('No signer available for this network');
      }
      
      logger.info(`Executing Uniswap swap for ${amount} ${fromToken} to ${toToken}`);
      
      // If fromToken is not ETH, approve the router to spend tokens
      if (fromToken !== ethers.constants.AddressZero) {
        logger.info(`Approving Uniswap to spend ${amount} tokens`);
        
        // ERC20 ABI for approval
        const erc20ABI = [
          'function approve(address spender, uint256 amount) returns (bool)',
          'function allowance(address owner, address spender) view returns (uint256)',
        ];
        
        const tokenContract = new ethers.Contract(fromToken, erc20ABI, this.signer);
        
        // Check existing allowance
        const allowance = await tokenContract.allowance(this.signer.address, this.routerAddress);
        
        if (allowance.lt(amount)) {
          const approveTx = await tokenContract.approve(this.routerAddress, amount);
          await web3Utils.waitForTransaction(approveTx.hash, this.network);
          logger.info(`Approval successful: ${approveTx.hash}`);
        } else {
          logger.info(`Allowance of ${ethers.utils.formatEther(allowance)} is sufficient`);
        }
      }
      
      // Prepare the transaction
      const txOptions = await web3Utils.getOptimizedGasPrice(this.network);
      
      // Execute the swap
      const tx = await this.writableRouter.exactInputSingle(
        [
          fromToken, // tokenIn
          toToken, // tokenOut
          feeTier, // fee
          this.signer.address, // recipient
          amount, // amountIn
          minAmountOut, // amountOutMinimum
          0, // sqrtPriceLimitX96 (0 = no limit)
        ],
        txOptions
      );
      
      logger.info(`Swap transaction submitted: ${tx.hash}`);
      
      // Wait for the transaction to be confirmed
      const receipt = await web3Utils.waitForTransaction(tx.hash, this.network);
      
      return {
        txHash: tx.hash,
        receipt,
        status: receipt.status === 1 ? 'success' : 'failed',
      };
    } catch (error) {
      logger.error(`Failed to execute Uniswap swap: ${error.message}`);
      throw error;
    }
  }
}

// Sushiswap connector
class SushiswapConnector extends BaseExchangeConnector {
  constructor(network) {
    super(network);
    this.routerAddress = tokens.dexRouters.sushiswap[network];
    
    // Router ABI (simplified for this example)
    this.routerABI = [
      'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
      'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
      'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    ];
    
    // Initialize router contract
    this.router = new ethers.Contract(this.routerAddress, this.routerABI, this.provider);
    
    // If signer is available, get writable contract
    if (this.signer) {
      this.writableRouter = new ethers.Contract(this.routerAddress, this.routerABI, this.signer);
    }
  }
  
  getName() {
    return 'Sushiswap';
  }
  
  isSupported() {
    return config.exchanges.sushiswap.enabled && !!this.routerAddress;
  }
  
  // Get quote for a token swap
  async getQuote(fromToken, toToken, amount) {
    try {
      logger.info(`Getting Sushiswap quote for ${amount} ${fromToken} to ${toToken}`);
      
      // Create the token path
      const path = [fromToken, toToken];
      
      // Get the amounts out
      const amounts = await this.router.getAmountsOut(amount, path);
      
      // The last element in the array is the output amount
      const outputAmount = amounts[amounts.length - 1];
      
      return {
        exchange: this.getName(),
        fromToken,
        toToken,
        inputAmount: amount,
        outputAmount,
        fee: 30, // Sushiswap has a fixed 0.3% fee
      };
    } catch (error) {
      logger.error(`Failed to get Sushiswap quote: ${error.message}`);
      throw error;
    }
  }
  
  async createUnsignedSwapTransaction(fromToken, toToken, amount, minAmountOut) {
    try {
      logger.info(`Creating unsigned Sushiswap transaction for ${amount} ${fromToken} to ${toToken}`);
      
      // Set deadline to 10 minutes from now
      const deadline = Math.floor(Date.now() / 1000) + 600;
      
      // Create the token path
      const path = [fromToken, toToken];
      
      // Make sure we're not trying to swap a token for itself
      if (fromToken.toLowerCase() === toToken.toLowerCase()) {
        throw new Error("Cannot swap a token for itself");
      }
      
      // Prepare the transaction data
      const routerInterface = new ethers.utils.Interface(this.routerABI);
      
      let data;
      if (fromToken === ethers.constants.AddressZero) {
        // ETH -> Token
        const wethAddress = tokens.nativeTokens[this.network].addresses.weth;
        path[0] = wethAddress;
        
        data = routerInterface.encodeFunctionData('swapExactETHForTokens', [
          minAmountOut,
          path,
          this.signer ? this.signer.address : ethers.constants.AddressZero,
          deadline
        ]);
      } else if (toToken === ethers.constants.AddressZero) {
        // Token -> ETH
        const wethAddress = tokens.nativeTokens[this.network].addresses.weth;
        path[1] = wethAddress;
        
        data = routerInterface.encodeFunctionData('swapExactTokensForETH', [
          amount,
          minAmountOut,
          path,
          this.signer ? this.signer.address : ethers.constants.AddressZero,
          deadline
        ]);
      } else {
        // Token -> Token
        data = routerInterface.encodeFunctionData('swapExactTokensForTokens', [
          amount,
          minAmountOut,
          path,
          this.signer ? this.signer.address : ethers.constants.AddressZero,
          deadline
        ]);
      }
      
      // Return the unsigned transaction
      return {
        to: this.routerAddress,
        data: data,
        value: fromToken === ethers.constants.AddressZero ? amount : 0,
      };
    } catch (error) {
      logger.error(`Failed to create Sushiswap transaction: ${error.message}`);
      throw error;
    }
  }

  // Execute a token swap
  async executeSwap(fromToken, toToken, amount, minAmountOut) {
    try {
      if (!this.signer) {
        throw new Error('No signer available for this network');
      }
      
      logger.info(`Executing Sushiswap swap for ${amount} ${fromToken} to ${toToken}`);
      
      // If fromToken is not ETH, approve the router to spend tokens
      if (fromToken !== ethers.constants.AddressZero) {
        logger.info(`Approving Sushiswap to spend ${amount} tokens`);
        
        // ERC20 ABI for approval
        const erc20ABI = [
          'function approve(address spender, uint256 amount) returns (bool)',
          'function allowance(address owner, address spender) view returns (uint256)',
        ];
        
        const tokenContract = new ethers.Contract(fromToken, erc20ABI, this.signer);
        
        // Check existing allowance
        const allowance = await tokenContract.allowance(this.signer.address, this.routerAddress);
        
        if (allowance.lt(amount)) {
          const approveTx = await tokenContract.approve(this.routerAddress, amount);
          await web3Utils.waitForTransaction(approveTx.hash, this.network);
          logger.info(`Approval successful: ${approveTx.hash}`);
        } else {
          logger.info(`Allowance of ${ethers.utils.formatEther(allowance)} is sufficient`);
        }
      }
      
      // Prepare the transaction
      const txOptions = await web3Utils.getOptimizedGasPrice(this.network);
      
      // Set deadline to 10 minutes from now
      const deadline = Math.floor(Date.now() / 1000) + 600;
      
      // Create the token path
      const path = [fromToken, toToken];
      
      // Execute the swap based on token types
      let tx;
      
      if (fromToken === ethers.constants.AddressZero) {
        // ETH -> Token
        const wethAddress = tokens.nativeTokens[this.network].address || ethers.constants.AddressZero;
        path[0] = wethAddress;
        
        tx = await this.writableRouter.swapExactETHForTokens(
          minAmountOut,
          path,
          this.signer.address,
          deadline,
          { ...txOptions, value: amount }
        );
      } else if (toToken === ethers.constants.AddressZero) {
        // Token -> ETH
        const wethAddress = tokens.nativeTokens[this.network].address || ethers.constants.AddressZero;
        path[1] = wethAddress;
        
        tx = await this.writableRouter.swapExactTokensForETH(
          amount,
          minAmountOut,
          path,
          this.signer.address,
          deadline,
          txOptions
        );
      } else {
        // Token -> Token
        tx = await this.writableRouter.swapExactTokensForTokens(
          amount,
          minAmountOut,
          path,
          this.signer.address,
          deadline,
          txOptions
        );
      }
      
      logger.info(`Swap transaction submitted: ${tx.hash}`);
      
      // Wait for the transaction to be confirmed
      const receipt = await web3Utils.waitForTransaction(tx.hash, this.network);
      
      return {
        txHash: tx.hash,
        receipt,
        status: receipt.status === 1 ? 'success' : 'failed',
      };
    } catch (error) {
      logger.error(`Failed to execute Sushiswap swap: ${error.message}`);
      throw error;
    }
  }
}

// Curve connector
class CurveConnector extends BaseExchangeConnector {
  constructor(network) {
    super(network);
    // Curve implementation would go here
    this.routerAddress = null; // Placeholder
  }
  
  getName() {
    return 'Curve';
  }
  
  isSupported() {
    return config.exchanges.curve.enabled;
  }
  
  // Get quote for a token swap
  async getQuote(fromToken, toToken, amount) {
    // Curve implementation would go here
    throw new Error('Curve connector not implemented yet');
  }
  
  // Execute a token swap
  async executeSwap(fromToken, toToken, amount, minAmountOut) {
    // Curve implementation would go here
    throw new Error('Curve connector not implemented yet');
  }
}

// Balancer connector
class BalancerConnector extends BaseExchangeConnector {
  constructor(network) {
    super(network);
    // Balancer implementation would go here
    this.routerAddress = null; // Placeholder
  }
  
  getName() {
    return 'Balancer';
  }
  
  isSupported() {
    return config.exchanges.balancer.enabled;
  }
  
  // Get quote for a token swap
  async getQuote(fromToken, toToken, amount) {
    // Balancer implementation would go here
    throw new Error('Balancer connector not implemented yet');
  }
  
  // Execute a token swap
  async executeSwap(fromToken, toToken, amount, minAmountOut) {
    // Balancer implementation would go here
    throw new Error('Balancer connector not implemented yet');
  }
}

module.exports = {
  ExchangeConnectorFactory,
  BaseExchangeConnector,
  UniswapConnector,
  SushiswapConnector,
  CurveConnector,
  BalancerConnector,
};