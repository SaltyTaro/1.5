const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../../config/config');
const tokens = require('../../config/tokens');
const web3Utils = require('./web3');
const logger = web3Utils.logger;

// ABI for ERC20 tokens
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
];

// ABI for AAVE flash loan
const AAVE_FLASH_LOAN_ABI = [
  'function flashLoan(address receiverAddress, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external returns ()',
];

// Flash loan states
const FLASH_LOAN_STATES = {
  INACTIVE: 0,
  PENDING: 1,
  COMPLETED: 2,
  FAILED: 3,
};

let flashLoanState = FLASH_LOAN_STATES.INACTIVE;
let flashLoanData = null;

// Get the token price from an oracle or price feed
const getTokenPrice = async (tokenAddress, network) => {
  try {
    logger.info(`Getting price for token ${tokenAddress} on ${network}`);
    
    // In a production environment, you would integrate with a reliable price oracle
    // For this example, we'll simulate price feeds with varying prices on different networks
    
    // Find the token in our config
    const tokenInfo = tokens.lsdTokens.find(token => 
      Object.values(token.addresses).includes(tokenAddress)
    );
    
    if (!tokenInfo) {
      throw new Error(`Token ${tokenAddress} not found in configuration`);
    }
    
    // Base prices for LSDs (as a ratio to the base asset, e.g., ETH)
    const basePrices = {
      'stETH': 0.99,
      'wstETH': 1.12, // wstETH is worth more ETH due to staking rewards accumulation
      'rETH': 1.04,
      'cbETH': 1.02,
      'frxETH': 0.995,
      'sfrxETH': 1.03,
    };
    
    // Add some variance based on network to simulate price differences
    const networkVariances = {
      'ethereum': 0,
      'arbitrum': 0.005,
      'optimism': -0.003,
      'polygon': 0.002,
      'base': -0.001,
    };
    
    // Calculate the price with network variance
    const basePrice = basePrices[tokenInfo.symbol] || 1;
    const variance = networkVariances[network] || 0;
    const price = basePrice + variance;
    
    // Also get the price in USD
    // Assume ETH price is around $3000
    const ethUsdPrice = 3000;
    const usdPrice = price * ethUsdPrice;
    
    return {
      tokenSymbol: tokenInfo.symbol,
      priceInEth: price,
      priceInUsd: usdPrice,
    };
  } catch (error) {
    logger.error(`Failed to get token price: ${error.message}`);
    throw error;
  }
};

// Execute a token swap on a DEX
const swapTokens = async (network, fromToken, toToken, amount, maxSlippage = 0.5) => {
  try {
    logger.info(`Swapping ${amount} of ${fromToken} to ${toToken} on ${network}`);
    
    const signer = web3Utils.getSigner(network);
    const slippageBps = Math.floor(maxSlippage * 100); // Convert percentage to basis points
    
    // Choose the exchange to use based on configuration
    if (config.exchanges.uniswap.enabled) {
      return await swapOnUniswap(signer, network, fromToken, toToken, amount, slippageBps);
    } 
    else if (config.exchanges.sushiswap.enabled) {
      return await swapOnSushiswap(signer, network, fromToken, toToken, amount, slippageBps);
    }
    else {
      throw new Error('No exchange provider enabled');
    }
  } catch (error) {
    logger.error(`Swap operation failed: ${error.message}`);
    throw error;
  }
};

// Swap tokens on Uniswap
const swapOnUniswap = async (signer, network, fromToken, toToken, amount, slippageBps) => {
  try {
    logger.info(`Swapping on Uniswap V3`);
    
    // Get the router address
    const routerAddress = tokens.dexRouters.uniswapV3[network];
    if (!routerAddress) {
      throw new Error(`Uniswap V3 router not configured for network ${network}`);
    }
    
    // Uniswap V3 Router ABI (simplified for the example)
    const routerABI = [
      'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)',
    ];
    
    const router = new ethers.Contract(routerAddress, routerABI, signer);
    
    // If fromToken is not ETH, approve the router to spend tokens
    if (fromToken !== ethers.constants.AddressZero) {
      logger.info(`Approving Uniswap to spend ${amount} tokens`);
      
      const tokenContract = new ethers.Contract(fromToken, ERC20_ABI, signer);
      const approveTx = await tokenContract.approve(routerAddress, amount);
      await web3Utils.waitForTransaction(approveTx.hash, network);
      
      logger.info(`Approval successful: ${approveTx.hash}`);
    }
    
    // Get the expected output amount (in a real implementation, you would use the Uniswap SDK or API)
    // For simplicity, we'll estimate based on the prices
    const fromTokenPrice = await getTokenPrice(fromToken, network);
    const toTokenPrice = await getTokenPrice(toToken, network);
    
    const expectedOutputAmount = amount
      .mul(ethers.utils.parseEther(fromTokenPrice.priceInEth.toString()))
      .div(ethers.utils.parseEther(toTokenPrice.priceInEth.toString()));
    
    // Calculate minimum output with slippage
    const minOutputAmount = expectedOutputAmount
      .mul(10000 - slippageBps)
      .div(10000);
    
    // Prepare the transaction
    const txOptions = await web3Utils.getOptimizedGasPrice(network);
    
    // Execute the swap
    const tx = await router.exactInputSingle(
      [
        fromToken, // tokenIn
        toToken, // tokenOut
        3000, // fee (0.3%)
        signer.address, // recipient
        amount, // amountIn
        minOutputAmount, // amountOutMinimum
        0, // sqrtPriceLimitX96 (0 = no limit)
      ],
      txOptions
    );
    
    logger.info(`Swap transaction submitted: ${tx.hash}`);
    
    // Wait for the transaction to be confirmed
    const receipt = await web3Utils.waitForTransaction(tx.hash, network);
    
    // Parse the output amount from the transaction receipt
    // In a real implementation, you would parse the event logs to get the exact output amount
    // For simplicity, we'll assume the expected output
    
    return {
      txHash: tx.hash,
      receipt,
      inputAmount: amount,
      outputAmount: expectedOutputAmount, // This would actually come from the event logs
      status: 'success',
    };
  } catch (error) {
    logger.error(`Failed to swap on Uniswap: ${error.message}`);
    throw error;
  }
};

// Swap tokens on Sushiswap
const swapOnSushiswap = async (signer, network, fromToken, toToken, amount, slippageBps) => {
  try {
    logger.info(`Swapping on Sushiswap`);
    
    // Get the router address
    const routerAddress = tokens.dexRouters.sushiswap[network];
    if (!routerAddress) {
      throw new Error(`Sushiswap router not configured for network ${network}`);
    }
    
    // Sushiswap Router ABI (simplified for the example)
    const routerABI = [
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
      'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
      'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    ];
    
    const router = new ethers.Contract(routerAddress, routerABI, signer);
    
    // If fromToken is not ETH, approve the router to spend tokens
    if (fromToken !== ethers.constants.AddressZero) {
      logger.info(`Approving Sushiswap to spend ${amount} tokens`);
      
      const tokenContract = new ethers.Contract(fromToken, ERC20_ABI, signer);
      const approveTx = await tokenContract.approve(routerAddress, amount);
      await web3Utils.waitForTransaction(approveTx.hash, network);
      
      logger.info(`Approval successful: ${approveTx.hash}`);
    }
    
    // Get the expected output amount (in a real implementation, you would use the SushiSwap SDK or API)
    // For simplicity, we'll estimate based on the prices
    const fromTokenPrice = await getTokenPrice(fromToken, network);
    const toTokenPrice = await getTokenPrice(toToken, network);
    
    const expectedOutputAmount = amount
      .mul(ethers.utils.parseEther(fromTokenPrice.priceInEth.toString()))
      .div(ethers.utils.parseEther(toTokenPrice.priceInEth.toString()));
    
    // Calculate minimum output with slippage
    const minOutputAmount = expectedOutputAmount
      .mul(10000 - slippageBps)
      .div(10000);
    
    // Prepare the transaction
    const txOptions = await web3Utils.getOptimizedGasPrice(network);
    
    // Set deadline to 10 minutes from now
    const deadline = Math.floor(Date.now() / 1000) + 600;
    
    // Execute the swap based on token types
    let tx;
    
    if (fromToken === ethers.constants.AddressZero) {
      // ETH -> Token
      tx = await router.swapExactETHForTokens(
        minOutputAmount,
        [tokens.nativeTokens[network].address, toToken],
        signer.address,
        deadline,
        { ...txOptions, value: amount }
      );
    } else if (toToken === ethers.constants.AddressZero) {
      // Token -> ETH
      tx = await router.swapExactTokensForETH(
        amount,
        minOutputAmount,
        [fromToken, tokens.nativeTokens[network].address],
        signer.address,
        deadline,
        txOptions
      );
    } else {
      // Token -> Token
      tx = await router.swapExactTokensForTokens(
        amount,
        minOutputAmount,
        [fromToken, toToken],
        signer.address,
        deadline,
        txOptions
      );
    }
    
    logger.info(`Swap transaction submitted: ${tx.hash}`);
    
    // Wait for the transaction to be confirmed
    const receipt = await web3Utils.waitForTransaction(tx.hash, network);
    
    return {
      txHash: tx.hash,
      receipt,
      inputAmount: amount,
      outputAmount: expectedOutputAmount, // This would actually come from the event logs
      status: 'success',
    };
  } catch (error) {
    logger.error(`Failed to swap on Sushiswap: ${error.message}`);
    throw error;
  }
};

// Execute a flash loan
const executeFlashLoan = async (network, token, amount, callbackFunction) => {
  try {
    if (!config.arbitrage.flashLoanEnabled) {
      logger.info('Flash loans are disabled in configuration');
      return null;
    }
    
    logger.info(`Executing flash loan for ${amount} of ${token} on ${network}`);
    
    // Check if we're already in a flash loan
    if (flashLoanState !== FLASH_LOAN_STATES.INACTIVE) {
      throw new Error('Another flash loan is already in progress');
    }
    
    // Set flash loan state
    flashLoanState = FLASH_LOAN_STATES.PENDING;
    flashLoanData = {
      network,
      token,
      amount,
      callback: callbackFunction,
    };
    
    const signer = web3Utils.getSigner(network);
    
    // Get the AAVE lending pool address
    const lendingPoolAddress = tokens.flashLoanProviders.aave[network];
    if (!lendingPoolAddress) {
      throw new Error(`AAVE lending pool not configured for network ${network}`);
    }
    
    const lendingPool = new ethers.Contract(lendingPoolAddress, AAVE_FLASH_LOAN_ABI, signer);
    
    // Prepare the flash loan parameters
    const receiverAddress = signer.address; // In a real implementation, this would be a contract address
    const assets = [token];
    const amounts = [amount];
    const modes = [0]; // 0 = no debt (flash loan)
    const onBehalfOf = signer.address;
    
    // Encode the callback data
    // In a real implementation, this would contain the arbitrage logic
    const params = ethers.utils.defaultAbiCoder.encode(
      ['string'],
      ['ARBITRAGE_CALLBACK']
    );
    
    // Prepare the transaction
    const txOptions = await web3Utils.getOptimizedGasPrice(network);
    
    // Execute the flash loan
    const tx = await lendingPool.flashLoan(
      receiverAddress,
      assets,
      amounts,
      modes,
      onBehalfOf,
      params,
      0, // referral code
      txOptions
    );
    
    logger.info(`Flash loan transaction submitted: ${tx.hash}`);
    
    // Wait for the transaction to be confirmed
    const receipt = await web3Utils.waitForTransaction(tx.hash, network);
    
    // Execute the callback function manually (since we don't have a real contract to handle it)
    const callbackResult = await callbackFunction(token, amount);
    
    // Set flash loan state to completed
    flashLoanState = FLASH_LOAN_STATES.COMPLETED;
    
    return {
      txHash: tx.hash,
      receipt,
      callbackResult,
      status: 'success',
    };
  } catch (error) {
    logger.error(`Flash loan operation failed: ${error.message}`);
    
    // Set flash loan state to failed
    flashLoanState = FLASH_LOAN_STATES.FAILED;
    
    throw error;
  } finally {
    // Reset flash loan data
    flashLoanData = null;
  }
};

// Check if the flash loan can be repaid with a profit
const canRepayFlashLoan = (flashLoanAmount, currentBalance) => {
  // AAVE flash loan fee is 0.09%
  const loanFee = flashLoanAmount.mul(9).div(10000);
  const totalRepayment = flashLoanAmount.add(loanFee);
  
  return currentBalance.gte(totalRepayment);
};

// Calculate the flash loan fee
const calculateFlashLoanFee = (amount) => {
  // AAVE flash loan fee is 0.09%
  return amount.mul(9).div(10000);
};

module.exports = {
  getTokenPrice,
  swapTokens,
  executeFlashLoan,
  canRepayFlashLoan,
  calculateFlashLoanFee,
  ERC20_ABI,
  FLASH_LOAN_STATES,
};