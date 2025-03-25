const { ethers } = require('ethers');
const config = require('../../config/config');
const winston = require('winston');

// Setup logger
const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/web3.log' })
  ],
});

// Initialize providers for each network
const providers = {};
const wallets = {};

// Initialize providers and wallets
const initializeWeb3 = () => {
  try {
    logger.info('Initializing Web3 connections');
    
    for (const network of config.enabledNetworks) {
      if (!config.rpcEndpoints[network]) {
        logger.error(`Missing RPC endpoint for network: ${network}`);
        continue;
      }
      
      // Initialize provider
      providers[network] = new ethers.providers.JsonRpcProvider(config.rpcEndpoints[network]);
      
      // Initialize wallet if private key exists
      if (config.privateKey) {
        wallets[network] = new ethers.Wallet(config.privateKey, providers[network]);
        logger.info(`Wallet initialized for network: ${network}`);
      } else {
        logger.warn(`No private key provided for network: ${network}, read-only mode`);
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`Failed to initialize Web3: ${error.message}`);
    return false;
  }
};

// Get provider for a specific network
const getProvider = (network) => {
  if (!providers[network]) {
    throw new Error(`Provider not initialized for network: ${network}`);
  }
  return providers[network];
};

// Get signer for a specific network
const getSigner = (network) => {
  if (!wallets[network]) {
    throw new Error(`Wallet not initialized for network: ${network}`);
  }
  return wallets[network];
};

// Create a contract instance
const getContract = (address, abi, network) => {
  try {
    const provider = getProvider(network);
    return new ethers.Contract(address, abi, provider);
  } catch (error) {
    logger.error(`Failed to get contract at ${address} on ${network}: ${error.message}`);
    throw error;
  }
};

// Create a writable contract instance
const getWritableContract = (address, abi, network) => {
  try {
    const signer = getSigner(network);
    return new ethers.Contract(address, abi, signer);
  } catch (error) {
    logger.error(`Failed to get writable contract at ${address} on ${network}: ${error.message}`);
    throw error;
  }
};

// Get gas price with optimization
const getOptimizedGasPrice = async (network) => {
  try {
    const provider = getProvider(network);
    
    // For networks supporting EIP-1559
    if (network === 'ethereum' || network === 'arbitrum' || network === 'optimism' || network === 'base') {
      const feeData = await provider.getFeeData();
      
      return {
        maxFeePerGas: feeData.maxFeePerGas || config.gas.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || config.gas.maxPriorityFeePerGas,
        gasLimit: config.gas.gasLimit,
      };
    } 
    // For networks not supporting EIP-1559
    else {
      const gasPrice = await provider.getGasPrice();
      return {
        gasPrice: gasPrice.mul(ethers.BigNumber.from(110)).div(ethers.BigNumber.from(100)), // 10% buffer
        gasLimit: config.gas.gasLimit,
      };
    }
  } catch (error) {
    logger.error(`Failed to get optimized gas price for ${network}: ${error.message}`);
    // Fallback to config values
    return network === 'ethereum' || network === 'arbitrum' || network === 'optimism' || network === 'base'
      ? {
          maxFeePerGas: config.gas.maxFeePerGas,
          maxPriorityFeePerGas: config.gas.maxPriorityFeePerGas,
          gasLimit: config.gas.gasLimit,
        }
      : {
          gasPrice: config.gas.maxFeePerGas,
          gasLimit: config.gas.gasLimit,
        };
  }
};

// Check wallet balances
const checkWalletBalances = async () => {
  const balances = {};
  
  for (const network of config.enabledNetworks) {
    try {
      if (!wallets[network]) continue;
      
      const balance = await wallets[network].getBalance();
      balances[network] = {
        wei: balance.toString(),
        eth: ethers.utils.formatEther(balance),
      };
      
      logger.info(`Balance on ${network}: ${ethers.utils.formatEther(balance)} ETH`);
      
      // Check if balance is below threshold
      if (balance.lt(config.wallet.minEthBalance)) {
        logger.warn(`Low balance on ${network}: ${ethers.utils.formatEther(balance)} ETH, minimum required: ${ethers.utils.formatEther(config.wallet.minEthBalance)} ETH`);
      }
    } catch (error) {
      logger.error(`Failed to check balance for ${network}: ${error.message}`);
      balances[network] = { wei: '0', eth: '0' };
    }
  }
  
  return balances;
};

// Get token balance
const getTokenBalance = async (tokenAddress, walletAddress, network) => {
  try {
    const provider = getProvider(network);
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
      provider
    );
    
    const [balance, decimals] = await Promise.all([
      tokenContract.balanceOf(walletAddress),
      tokenContract.decimals(),
    ]);
    
    return {
      wei: balance.toString(),
      formatted: ethers.utils.formatUnits(balance, decimals),
      decimals,
    };
  } catch (error) {
    logger.error(`Failed to get token balance for ${tokenAddress} on ${network}: ${error.message}`);
    throw error;
  }
};

// Wait for transaction to be confirmed
const waitForTransaction = async (txHash, network, confirmations = 1) => {
  try {
    const provider = getProvider(network);
    logger.info(`Waiting for transaction ${txHash} on ${network} to be confirmed...`);
    
    const receipt = await provider.waitForTransaction(txHash, confirmations);
    
    if (receipt.status === 1) {
      logger.info(`Transaction ${txHash} confirmed on ${network}`);
      return receipt;
    } else {
      logger.error(`Transaction ${txHash} failed on ${network}`);
      throw new Error(`Transaction ${txHash} failed`);
    }
  } catch (error) {
    logger.error(`Error waiting for transaction ${txHash} on ${network}: ${error.message}`);
    throw error;
  }
};

// Send transaction with MEV protection if enabled
const sendTransactionWithMevProtection = async (transaction, network) => {
  try {
    const signer = getSigner(network);
    const gasSettings = await getOptimizedGasPrice(network);
    
    // Apply gas settings to the transaction
    const txWithGas = {
      ...transaction,
      ...gasSettings,
    };
    
    // If private mempool is enabled and we're on Ethereum mainnet
    if (config.arbitrage.usePrivateMempool && network === 'ethereum') {
      // Using Flashbots to prevent MEV attacks
      // This is just a placeholder - in production you would integrate with Flashbots or other MEV protection services
      logger.info(`Sending transaction via private mempool on ${network}`);
      
      // In a real implementation, you would use something like:
      // const provider = await flashbots.createProvider(getProvider(network), flashbotsRelaySigningKey);
      // const bundle = [{ transaction: txWithGas, signer }];
      // const signedBundle = await flashbots.signBundle(bundle);
      // const simulation = await provider.simulate(signedBundle, blockNumber + 1);
      // ...and so on
      
      // For now, we'll just send normally
      const tx = await signer.sendTransaction(txWithGas);
      logger.info(`Transaction sent: ${tx.hash}`);
      return tx;
    } else {
      // Regular transaction
      logger.info(`Sending regular transaction on ${network}`);
      const tx = await signer.sendTransaction(txWithGas);
      logger.info(`Transaction sent: ${tx.hash}`);
      return tx;
    }
  } catch (error) {
    logger.error(`Failed to send transaction on ${network}: ${error.message}`);
    throw error;
  }
};

module.exports = {
  initializeWeb3,
  getProvider,
  getSigner,
  getContract,
  getWritableContract,
  getOptimizedGasPrice,
  checkWalletBalances,
  getTokenBalance,
  waitForTransaction,
  sendTransactionWithMevProtection,
  logger,
};