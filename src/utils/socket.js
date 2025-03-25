const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../../config/config');
const tokens = require('../../config/tokens');
const web3Utils = require('./web3');
const logger = web3Utils.logger;

/**
 * Socket Protocol utility functions for cross-chain interactions
 */

// Helper function to query Socket API for transaction details
const getTransactionDetails = async (txHash) => {
  try {
    const apiUrl = `${config.bridges.socket.apiUrl}/getDetailsByTxHash?txHash=${txHash}`;
    const response = await axios.get(apiUrl);
    return response.data;
  } catch (error) {
    logger.error(`Failed to get Socket transaction details: ${error.message}`);
    throw error;
  }
};

// Helper function to check if Socket supports a specific token and route
const isRouteSupported = async (sourceNetwork, destinationNetwork, tokenAddress) => {
  try {
    const sourceChainId = tokens.CHAIN_IDS[sourceNetwork];
    const destinationChainId = tokens.CHAIN_IDS[destinationNetwork];
    
    if (!sourceChainId || !destinationChainId) {
      throw new Error(`Unknown chain IDs for networks: ${sourceNetwork}, ${destinationNetwork}`);
    }
    
    // Query Socket API for available routes
    const apiUrl = `${config.bridges.socket.apiUrl}/available-routes?originChainId=${sourceChainId}&destinationChainId=${destinationChainId}&originToken=${tokenAddress}`;
    const response = await axios.get(apiUrl);
    
    // Check if we have routes available
    return response.data && 
           response.data.response && 
           Array.isArray(response.data.response) && 
           response.data.response.length > 0;
  } catch (error) {
    logger.error(`Failed to check if Socket route is supported: ${error.message}`);
    return false;
  }
};

// Helper function to monitor a Socket transaction until completion
const monitorTransaction = async (txHash, timeoutMs = 600000, pollIntervalMs = 10000) => {
  const startTime = Date.now();
  let lastStatus = null;
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const details = await getTransactionDetails(txHash);
      
      if (!details || !details.response || !details.response[0]) {
        logger.info(`No data available yet for transaction ${txHash}`);
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      
      const status = details.response[0].status;
      
      // Log status changes
      if (status !== lastStatus) {
        logger.info(`Socket transaction ${txHash} status: ${status}`);
        lastStatus = status;
      }
      
      // Check if the transaction is completed or failed
      if (status === 'COMPLETED') {
        return { success: true, details };
      } else if (status === 'REVERTING') {
        return { success: false, details, error: 'Transaction reverted' };
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      logger.error(`Error monitoring Socket transaction: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }
  
  throw new Error(`Timeout waiting for Socket transaction ${txHash} to complete`);
};

// Export the functions
module.exports = {
  getTransactionDetails,
  isRouteSupported,
  monitorTransaction
};