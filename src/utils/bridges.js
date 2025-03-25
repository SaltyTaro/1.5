const { ethers } = require('ethers');
const config = require('../../config/config');
const tokens = require('../../config/tokens');
const web3Utils = require('./web3');
const logger = web3Utils.logger;
const axios = require('axios');

// ABI for Socket Protocol contracts
const SOCKET_ABI = [
  'function bridgeTokens(address inputToken, address recipient, uint256 amount, uint32 destinationChainId, uint256 slippage) external payable returns (bytes32)',
  'function getBestRoute(address inputToken, uint256 amount, uint32 destinationChainId) external view returns (bytes memory routeData)',
  'function estimateFees(bytes memory routeData) external view returns (uint256 fees)',
];

// Socket contract addresses
const SOCKET_ADDRESSES = {
  ethereum: '0xd0d936ab47c15ee0ce2d62602f1be1da148f91d5', // Changed to lowercase
  arbitrum: '0x2E312166A5bB0B9169e923C385a45Ab4AEf0EaEb',
  optimism: '0x6ffe4516cabb731de61e31fb3bcd6ff8740d9d98', // Changed to lowercase
  polygon: '0x03C4AD107D4c797227Eddc0B6D6Dfaa5e3b3933e',
  base: '0x43e26600B91C1C9F5aD42FD9C5f93f2C4E23F4A8',
};

// ABI for Across SpokePool contract based on documentation
const ACROSS_ABI = [
  'function deposit(address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp, bytes memory message, uint256 maxCount) external payable',
  'function speedUpDeposit(address depositor, int64 updatedRelayerFeePct, uint32 depositId, address updatedRecipient, bytes memory updatedMessage, bytes memory depositorSignature) external',
  'function getCurrentTime() external view returns (uint32)',
  'function depositQuoteTimeBuffer() external view returns (uint32)',
];

// Chain IDs for each network
const CHAIN_IDS = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  base: 8453,
};

// Across SpokePool addresses from the documentation
const BRIDGE_ADDRESSES = {
  across: {
    ethereum: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5', // Ethereum_SpokePool
    arbitrum: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a', // Arbitrum_SpokePool
    optimism: '0x6f26Bf09B1C792e3228e5467807a900A503c0281', // Optimism_SpokePool
    polygon: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096', // Polygon_SpokePool
    base: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64', // Base_SpokePool
  },
  // Keeping Connext as a fallback option
  connext: {
    ethereum: '0x8898B472C54c31894e3B9bb83cEA802a5d0e63C6',
    arbitrum: '0xEE9deC2712cCE65174B561151701Bf54b99C24C8',
    optimism: '0x8f7492DE823025b4CfaAB1D34c58963F2af5DEDA',
    polygon: '0x421a4b8a656B1521d75878846aEc7d0FeD3A1864',
    base: '0xB7CF5324641bD9F82903572f4D55d26265068Aff',
  },
};

// Get the bridge fee estimation
const getBridgeFee = async (sourceNetwork, destinationNetwork, tokenAddress, amount) => {
  try {
    logger.info(`Estimating bridge fee from ${sourceNetwork} to ${destinationNetwork} for token ${tokenAddress}`);
    
    // If Socket Protocol is enabled, get fees from its API
    if (config.bridges.socket.enabled) {
      try {
        const provider = web3Utils.getProvider(sourceNetwork);
        const socketAddress = SOCKET_ADDRESSES[sourceNetwork];
        const socketContract = new ethers.Contract(socketAddress, SOCKET_ABI, provider);
        const destinationChainId = CHAIN_IDS[destinationNetwork];
        
        // Get best route data
        const routeData = await socketContract.getBestRoute(
          tokenAddress,
          amount,
          destinationChainId
        );
        
        // Estimate fees for the route
        const fees = await socketContract.estimateFees(routeData);
        
        logger.info(`Socket Protocol estimated fees: ${ethers.utils.formatEther(fees)} ETH`);
        return fees; // Return just the fee amount, not an object
      } catch (socketError) {
        logger.warn(`Failed to get Socket Protocol fees, trying Across: ${socketError.message}`);
        
        // Fall back to Across if enabled
        if (config.bridges.across.enabled) {
          const acrossFees = await getAcrossFees(sourceNetwork, destinationNetwork, tokenAddress, amount);
          return acrossFees.feeAmount; // Return just the fee amount
        }
        
        // Default fallback
        const fallbackFee = ethers.BigNumber.from(amount).mul(5).div(1000); // 0.5%
        logger.info(`Using fallback fee amount: ${ethers.utils.formatEther(fallbackFee)} ETH`);
        return fallbackFee;
      }
    } 
    else if (config.bridges.across.enabled) {
      const acrossFees = await getAcrossFees(sourceNetwork, destinationNetwork, tokenAddress, amount);
      return acrossFees.feeAmount; // Return just the fee amount
    }
    else {
      throw new Error('No bridge provider enabled');
    }
  } catch (error) {
    logger.error(`Failed to estimate bridge fee: ${error.message}`);
    // Default to a conservative 0.5% fee
    const fallbackFee = ethers.BigNumber.from(amount).mul(5).div(1000); // 0.5%
    logger.info(`Using fallback fee amount: ${ethers.utils.formatEther(fallbackFee)} ETH`);
    return fallbackFee;
  }
};

// Helper function to get fees from Across API
const getAcrossFees = async (sourceNetwork, destinationNetwork, tokenAddress, amount) => {
  try {
    const originChainId = CHAIN_IDS[sourceNetwork];
    const destinationChainId = CHAIN_IDS[destinationNetwork];
    
    logger.info(`Querying Across API for suggested fees: token=${tokenAddress}, destinationChainId=${destinationChainId}, amount=${amount}`);
    
    // Format the amount properly for the API
    // The API might expect the amount in a different format, so let's try a more standard format
    const amountStr = amount.toString();
    
    // Construct Across API URL for suggested fees
    const apiUrl = `https://across.to/api/suggested-fees?token=${tokenAddress}&destinationChainId=${destinationChainId}&amount=${amountStr}&originChainId=${originChainId}`;
    
    try {
      const response = await axios.get(apiUrl);
      const feeData = response.data;
      
      logger.info(`Across API returned fees: ${JSON.stringify(feeData)}`);
      
      // Extract the relayer fee from the response
      // relayFeePct includes LP fee in the latest version
      const relayerFeeBps = ethers.BigNumber.from(feeData.relayFeePct);
      
      // Calculate fee amount based on percentage (relayFeePct is in bps where 1e18 = 100%)
      const feeAmount = amount.mul(relayerFeeBps).div(ethers.BigNumber.from('1000000000000000000'));
      
      logger.info(`Calculated fee amount: ${ethers.utils.formatEther(feeAmount)} ETH`);
      
      return {
        feeAmount,
        relayerFeePct: feeData.relayFeePct,
        quoteTimestamp: feeData.timestamp
      };
    } catch (axiosError) {
      logger.error(`Across API request failed: ${axiosError.message}`);
      logger.error(`API URL: ${apiUrl}`);
      if (axiosError.response) {
        logger.error(`Status: ${axiosError.response.status}`);
        logger.error(`Data: ${JSON.stringify(axiosError.response.data)}`);
      }
      throw new Error(`Across API request failed: ${axiosError.message}`);
    }
  } catch (error) {
    logger.error(`Error querying Across API: ${error.message}`);
    // Fall back to a conservative estimate
    const fallbackFeePct = ethers.utils.parseUnits('0.005', 18); // 0.5%
    const feeAmount = amount.mul(fallbackFeePct).div(ethers.BigNumber.from('1000000000000000000'));
    
    logger.info(`Using fallback fee amount: ${ethers.utils.formatEther(feeAmount)} ETH`);
    
    return {
      feeAmount,
      relayerFeePct: fallbackFeePct.toString(),
      quoteTimestamp: Math.floor(Date.now() / 1000)
    };
  }
};

// Bridge tokens using Socket Protocol
const bridgeWithSocket = async (sourceNetwork, destinationNetwork, tokenAddress, amount, recipient) => {
  try {
    logger.info(`Bridging ${amount} tokens from ${sourceNetwork} to ${destinationNetwork} using Socket Protocol`);
    
    const signer = web3Utils.getSigner(sourceNetwork);
    const socketAddress = SOCKET_ADDRESSES[sourceNetwork];
    const socketContract = new ethers.Contract(socketAddress, SOCKET_ABI, signer);
    
    // Get the destination chain ID
    const destinationChainId = CHAIN_IDS[destinationNetwork];
    if (!destinationChainId) {
      throw new Error(`Unknown destination chain: ${destinationNetwork}`);
    }
    
    // Approve the token spending if it's not ETH
    if (tokenAddress !== ethers.constants.AddressZero) {
      logger.info(`Approving Socket to spend ${amount} tokens`);
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function approve(address spender, uint256 amount) returns (bool)'],
        signer
      );
      
      const approveTx = await tokenContract.approve(socketAddress, amount);
      await web3Utils.waitForTransaction(approveTx.hash, sourceNetwork);
      logger.info(`Approval successful: ${approveTx.hash}`);
    }
    
    // Get the best route from Socket Protocol
    const routeData = await socketContract.getBestRoute(
      tokenAddress,
      amount,
      destinationChainId
    );
    
    logger.info(`Got best route from Socket Protocol`);
    
    // Estimate fees for the route
    const fees = await socketContract.estimateFees(routeData);
    logger.info(`Estimated fees: ${ethers.utils.formatEther(fees)} ETH`);
    
    // Prepare the transaction options
    const txOptions = await web3Utils.getOptimizedGasPrice(sourceNetwork);
    
    // Add value if sending ETH or need to pay fees
    const txValue = tokenAddress === ethers.constants.AddressZero 
      ? amount.add(fees) 
      : fees;
    
    // Execute the bridge
    const slippage = 100; // 1% slippage (100 basis points)
    const tx = await socketContract.bridgeTokens(
      tokenAddress,
      recipient,
      amount,
      destinationChainId,
      slippage,
      { ...txOptions, value: txValue }
    );
    
    logger.info(`Bridge transaction submitted: ${tx.hash}`);
    
    // Wait for the transaction to be confirmed
    const receipt = await web3Utils.waitForTransaction(tx.hash, sourceNetwork);
    
    // Query transaction status from Socket API
    const socketApiUrl = `${config.bridges.socket.apiUrl}getDetailsByTxHash?txHash=${tx.hash}`;
    const response = await axios.get(socketApiUrl);
    logger.info(`Socket transaction status: ${JSON.stringify(response.data)}`);
    
    return {
      txHash: tx.hash,
      receipt,
      status: 'success',
      // Include Socket-specific data
      socketData: response.data
    };
  } catch (error) {
    logger.error(`Failed to bridge with Socket Protocol: ${error.message}`);
    throw error;
  }
};

// Bridge tokens using Across
const bridgeWithAcross = async (sourceNetwork, destinationNetwork, tokenAddress, amount, recipient) => {
  try {
    logger.info(`Bridging ${amount} tokens from ${sourceNetwork} to ${destinationNetwork} using Across`);
    
    const signer = web3Utils.getSigner(sourceNetwork);
    const acrossAddress = BRIDGE_ADDRESSES.across[sourceNetwork];
    const acrossContract = new ethers.Contract(acrossAddress, ACROSS_ABI, signer);
    
    // Get the destination chain ID
    const destinationChainId = CHAIN_IDS[destinationNetwork];
    if (!destinationChainId) {
      throw new Error(`Unknown destination chain: ${destinationNetwork}`);
    }
    
    // Approve the token spending if it's not ETH
    if (tokenAddress !== ethers.constants.AddressZero) {
      logger.info(`Approving Across to spend ${amount} tokens`);
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function approve(address spender, uint256 amount) returns (bool)'],
        signer
      );
      
      const approveTx = await tokenContract.approve(acrossAddress, amount);
      await web3Utils.waitForTransaction(approveTx.hash, sourceNetwork);
      logger.info(`Approval successful: ${approveTx.hash}`);
    }
    
    // Prepare the transaction
    const txOptions = await web3Utils.getOptimizedGasPrice(sourceNetwork);
    
    // Get suggested fees from Across API
    const fees = await getBridgeFee(sourceNetwork, destinationNetwork, tokenAddress, amount);
    
    // Get valid quoteTimestamp according to Across requirements
    const currentTime = await acrossContract.getCurrentTime();
    const quoteTimeBuffer = await acrossContract.depositQuoteTimeBuffer();
    const quoteTimestamp = Math.min(
      Math.floor(Date.now() / 1000),
      Number(currentTime) + Number(quoteTimeBuffer)
    );
    
    logger.info(`Using quoteTimestamp: ${quoteTimestamp}, relayerFeePct: ${fees.relayerFeePct}`);
    
    // Prepare value if sending ETH
    const txValue = tokenAddress === ethers.constants.AddressZero ? amount : 0;
    
    // Call the deposit function - following the Across SpokePool interface
    const tx = await acrossContract.deposit(
      recipient, // Recipient address on the destination chain
      tokenAddress, // originToken
      amount, // Amount to bridge
      destinationChainId, // Destination chain ID
      fees.relayerFeePct, // Relayer fee percentage from API
      quoteTimestamp, // Quote timestamp
      '0x', // Empty message
      ethers.constants.MaxUint256, // maxCount - set to max to avoid issues with UBA fee model
      { ...txOptions, value: txValue } // Include value if sending ETH
    );
    
    logger.info(`Bridge transaction submitted: ${tx.hash}`);
    
    // Wait for the transaction to be confirmed
    const receipt = await web3Utils.waitForTransaction(tx.hash, sourceNetwork);
    
    return {
      txHash: tx.hash,
      receipt,
      status: 'success',
    };
  } catch (error) {
    logger.error(`Failed to bridge with Across: ${error.message}`);
    throw error;
  }
};

// Bridge tokens using the best available bridge
const bridgeTokens = async (sourceNetwork, destinationNetwork, tokenAddress, amount, recipient) => {
  try {
    logger.info(`Initiating bridge from ${sourceNetwork} to ${destinationNetwork}`);
    
    // Check if the token exists on both networks
    const tokenInfo = tokens.lsdTokens.find(t => 
      t.addresses[sourceNetwork]?.toLowerCase() === tokenAddress.toLowerCase()
    );
    
    if (!tokenInfo || !tokenInfo.addresses[destinationNetwork]) {
      throw new Error(`Token ${tokenAddress} not supported on ${destinationNetwork}`);
    }
    
    // If Socket Protocol is enabled, try to use it first as it will find the optimal route
    if (config.bridges.socket.enabled) {
      try {
        logger.info(`Attempting to bridge via Socket Protocol for best route selection`);
        return await bridgeWithSocket(sourceNetwork, destinationNetwork, tokenAddress, amount, recipient);
      } catch (socketError) {
        logger.warn(`Socket Protocol bridge failed, falling back to Across: ${socketError.message}`);
        // If Socket fails, fall back to Across if enabled
        if (config.bridges.across.enabled) {
          return await bridgeWithAcross(sourceNetwork, destinationNetwork, tokenAddress, amount, recipient);
        }
        // If Across is not enabled either, rethrow the original error
        throw socketError;
      }
    } 
    // If Socket is not enabled but Across is, use Across
    else if (config.bridges.across.enabled) {
      logger.info(`Using Across for bridging (Socket Protocol disabled)`);
      return await bridgeWithAcross(sourceNetwork, destinationNetwork, tokenAddress, amount, recipient);
    }
    else {
      throw new Error('No bridge provider enabled');
    }
  } catch (error) {
    logger.error(`Bridge operation failed: ${error.message}`);
    throw error;
  }
};

// Get the estimated time for bridging
const getBridgingTime = (sourceNetwork, destinationNetwork) => {
  // Estimated times in minutes
  const bridgingTimes = {
    connext: {
      ethereum: {
        arbitrum: 15,
        optimism: 15,
        polygon: 20,
        base: 15,
      },
      arbitrum: {
        ethereum: 15,
        optimism: 30,
        polygon: 30,
        base: 30,
      },
      optimism: {
        ethereum: 15,
        arbitrum: 30,
        polygon: 30,
        base: 30,
      },
      polygon: {
        ethereum: 20,
        arbitrum: 30,
        optimism: 30,
        base: 30,
      },
      base: {
        ethereum: 15,
        arbitrum: 30,
        optimism: 30,
        polygon: 30,
      },
    },
    across: {
      ethereum: {
        arbitrum: 10,
        optimism: 10,
        polygon: 15,
        base: 10,
      },
      arbitrum: {
        ethereum: 10,
        optimism: 20,
        polygon: 20,
        base: 20,
      },
      optimism: {
        ethereum: 10,
        arbitrum: 20,
        polygon: 20,
        base: 20,
      },
      polygon: {
        ethereum: 15,
        arbitrum: 20,
        optimism: 20,
        base: 20,
      },
      base: {
        ethereum: 10,
        arbitrum: 20,
        optimism: 20,
        polygon: 20,
      },
    },
  };
  
  // Use the fastest bridge
  let fastestTime = Number.MAX_VALUE;
  
  if (config.bridges.connext.enabled) {
    const connextTime = bridgingTimes.connext[sourceNetwork]?.[destinationNetwork];
    if (connextTime) {
      fastestTime = Math.min(fastestTime, connextTime);
    }
  }
  
  if (config.bridges.across.enabled) {
    const acrossTime = bridgingTimes.across[sourceNetwork]?.[destinationNetwork];
    if (acrossTime) {
      fastestTime = Math.min(fastestTime, acrossTime);
    }
  }
  
  return fastestTime !== Number.MAX_VALUE ? fastestTime : 30; // Default to 30 minutes if unknown
};

// Speed up a slow bridge transfer
const speedUpAcrossDeposit = async (sourceNetwork, depositId, updatedRelayerFeePct, updatedRecipient = null, updatedMessage = null) => {
  try {
    logger.info(`Speeding up deposit ${depositId} on ${sourceNetwork} with updated relayerFeePct ${updatedRelayerFeePct}`);
    
    const signer = web3Utils.getSigner(sourceNetwork);
    const depositor = signer.address;
    const acrossAddress = BRIDGE_ADDRESSES.across[sourceNetwork];
    const acrossContract = new ethers.Contract(acrossAddress, ACROSS_ABI, signer);
    
    // If recipient or message not provided, use empty values
    updatedRecipient = updatedRecipient || depositor;
    updatedMessage = updatedMessage || '0x';
    
    // Generate signature for speed up deposit
    // In a production environment, this would use the EIP-712 standard for signing
    // For simplicity in this example, we'll use a dummy signature
    // This should be replaced with proper signature generation in production
    const dummySignature = '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    
    // Prepare the transaction
    const txOptions = await web3Utils.getOptimizedGasPrice(sourceNetwork);
    
    // Call the speedUpDeposit function
    const tx = await acrossContract.speedUpDeposit(
      depositor,
      updatedRelayerFeePct,
      depositId,
      updatedRecipient,
      updatedMessage,
      dummySignature,
      txOptions
    );
    
    logger.info(`Speed up transaction submitted: ${tx.hash}`);
    
    // Wait for the transaction to be confirmed
    const receipt = await web3Utils.waitForTransaction(tx.hash, sourceNetwork);
    
    return {
      txHash: tx.hash,
      receipt,
      status: 'success',
    };
  } catch (error) {
    logger.error(`Failed to speed up deposit: ${error.message}`);
    throw error;
  }
};

module.exports = {
  getBridgeFee,
  bridgeTokens,
  getBridgingTime,
  speedUpAcrossDeposit,
  CHAIN_IDS,
  BRIDGE_ADDRESSES,
  SOCKET_ADDRESSES
};