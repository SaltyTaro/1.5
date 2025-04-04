const { ethers } = require('ethers');
const config = require('../../config/config');
const { ExchangeConnectorFactory } = require('./connectors');
const web3Utils = require('../utils/web3');
const defiUtils = require('../utils/defi');
const logger = web3Utils.logger;
const tokens = require('../../config/tokens');

// Get the best quote across all enabled exchanges
const getBestQuote = async (network, fromToken, toToken, amount) => {
  try {
    logger.info(`Getting best quote for ${ethers.utils.formatEther(amount)} ${fromToken} to ${toToken} on ${network}`);
    
    // Check if trying to swap a token for itself
    if (fromToken.toLowerCase() === toToken.toLowerCase()) {
      throw new Error("Cannot swap a token for itself");
    }
    
    const quotes = [];
    
    // Get the WETH address for this network if needed
    const wethAddress = fromToken === ethers.constants.AddressZero ? 
                        tokens.nativeTokens[network]?.addresses?.weth || 
                        tokens.lsdTokens.find(t => t.symbol === 'WETH')?.addresses[network] : 
                        fromToken;
    
    // Get quotes from all enabled exchanges
    const enabledExchanges = Object.entries(config.exchanges)
      .filter(([_, details]) => details.enabled)
      .map(([exchange]) => exchange);
    
    logger.info(`Checking quotes from: ${enabledExchanges.join(', ')}`);
    
    for (const exchange of enabledExchanges) {
      try {
        const connector = ExchangeConnectorFactory.getConnector(exchange, network);
        
        if (connector.isSupported()) {
          // Use wethAddress for ETH (zero address)
          const quoteFromToken = fromToken === ethers.constants.AddressZero ? wethAddress : fromToken;
          const quoteToToken = toToken === ethers.constants.AddressZero ? wethAddress : toToken;
          
          // Make sure we're not trying to swap a token for itself
          if (quoteFromToken.toLowerCase() === quoteToToken.toLowerCase()) {
            logger.warn(`Skip getting quote from ${exchange}: Cannot swap token for itself`);
            continue;
          }
          
          const quote = await connector.getQuote(quoteFromToken, quoteToToken, amount);
          quotes.push(quote);
          logger.info(`${exchange} quote: ${ethers.utils.formatEther(quote.outputAmount)} tokens`);
        }
      } catch (error) {
        logger.warn(`Failed to get quote from ${exchange}: ${error.message}`);
      }
    }
    
    if (quotes.length === 0) {
      throw new Error('No quotes available from any exchange');
    }
    
    // Find the best quote
    const bestQuote = quotes.reduce((best, current) => {
      return current.outputAmount.gt(best.outputAmount) ? current : best;
    });
    
    logger.info(`Best quote from ${bestQuote.exchange}: ${ethers.utils.formatEther(bestQuote.outputAmount)} tokens`);
    
    return bestQuote;
  } catch (error) {
    logger.error(`Failed to get best quote: ${error.message}`);
    throw error;
  }
};

// Execute a swap using the best exchange
const executeSwap = async (network, fromToken, toToken, amount, maxSlippage = 0.5) => {
  try {
    logger.info(`Executing swap for ${amount} ${fromToken} to ${toToken} on ${network}`);
    
    // Get the best quote
    const bestQuote = await getBestQuote(network, fromToken, toToken, amount);
    
    // Calculate minimum output with slippage
    const slippageBps = Math.floor(maxSlippage * 100); // Convert percentage to basis points
    const minOutputAmount = bestQuote.outputAmount.mul(10000 - slippageBps).div(10000);
    
    logger.info(`Best quote from ${bestQuote.exchange}: ${ethers.utils.formatEther(bestQuote.outputAmount)} tokens`);
    logger.info(`Minimum acceptable output with ${maxSlippage}% slippage: ${ethers.utils.formatEther(minOutputAmount)} tokens`);
    
    // Execute the swap using the chosen exchange
    const connector = ExchangeConnectorFactory.getConnector(bestQuote.exchange.toLowerCase(), network);
    
    // Execute the swap
    const swapResult = await connector.executeSwap(fromToken, toToken, amount, minOutputAmount, bestQuote.fee);
    
    logger.info(`Swap executed: ${swapResult.txHash}`);
    
    return {
      ...swapResult,
      exchange: bestQuote.exchange,
      expectedOutput: bestQuote.outputAmount,
      minOutput: minOutputAmount,
      fromToken,
      toToken,
      amount,
    };
  } catch (error) {
    logger.error(`Failed to execute swap: ${error.message}`);
    throw error;
  }
};

// Estimate gas costs for a swap
const estimateSwapGasCost = async (network, fromToken, toToken, amount) => {
  try {
    logger.info(`Estimating gas cost for swap on ${network}`);
    
    // Check if trying to swap a token for itself
    if (fromToken.toLowerCase() === toToken.toLowerCase()) {
      throw new Error("Cannot estimate gas: attempting to swap a token for itself");
    }
    
    // Try to get the best quote
    try {
      const bestQuote = await getBestQuote(network, fromToken, toToken, amount);
      
      // Calculate minimum output with default slippage
      const minOutputAmount = bestQuote.outputAmount.mul(10000 - 50).div(10000); // 0.5% slippage
      
      // Get the exchange connector
      const connector = ExchangeConnectorFactory.getConnector(bestQuote.exchange.toLowerCase(), network);
      
      try {
        // Check if the connector has the createUnsignedSwapTransaction method
        if (typeof connector.createUnsignedSwapTransaction !== 'function') {
          throw new Error(`The ${bestQuote.exchange} connector does not implement createUnsignedSwapTransaction`);
        }
        
        // Create the transaction but don't send it
        const unsignedTx = await connector.createUnsignedSwapTransaction(
          fromToken,
          toToken,
          amount,
          minOutputAmount,
          bestQuote.fee
        );
        
        // Estimate gas
        const provider = web3Utils.getProvider(network);
        const gasEstimate = await provider.estimateGas(unsignedTx);
        
        // Get gas price
        const gasSettings = await web3Utils.getOptimizedGasPrice(network);
        
        // Calculate gas cost
        let gasCost;
        if (gasSettings.maxFeePerGas) {
          gasCost = gasEstimate.mul(gasSettings.maxFeePerGas);
        } else {
          gasCost = gasEstimate.mul(gasSettings.gasPrice || ethers.utils.parseUnits('30', 'gwei'));
        }
        
        logger.info(`Estimated gas cost: ${ethers.utils.formatEther(gasCost)} ETH`);
        
        return {
          gasEstimate,
          gasCost,
          gasCostEth: ethers.utils.formatEther(gasCost),
        };
      } catch (txError) {
        logger.error(`Failed to create/estimate unsigned transaction: ${txError.message}`);
        throw txError;
      }
    } catch (quoteError) {
      logger.error(`Failed to get quote for gas estimation: ${quoteError.message}`);
      throw quoteError;
    }
  } catch (error) {
    logger.error(`Failed to estimate swap gas cost: ${error.message}`);
    
    // Return a default estimate
    const gasLimit = ethers.BigNumber.from(config.gas.gasLimit || "500000");
    const gasPrice = config.gas.maxFeePerGas || ethers.utils.parseUnits('30', 'gwei');
    const gasCost = gasLimit.mul(gasPrice);
    
    logger.info(`Using default gas estimate: ${ethers.utils.formatEther(gasCost)} ETH`);
    
    return {
      gasEstimate: gasLimit,
      gasCost: gasCost,
      gasCostEth: ethers.utils.formatEther(gasCost),
    };
  }
};

module.exports = {
  getBestQuote,
  executeSwap,
  estimateSwapGasCost,
};