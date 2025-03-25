const { ethers } = require('ethers');
const config = require('../../config/config');
const tokens = require('../../config/tokens');
const web3Utils = require('../utils/web3');
const defiUtils = require('../utils/defi');
const bridgesUtils = require('../utils/bridges');
const swapper = require('../exchanges/swapper');
const calculator = require('./calculator');
const logger = web3Utils.logger;

// Find all LSD tokens that exist on multiple chains
const findCrosschainLSDTokens = () => {
  const crosschainTokens = [];
  
  // Filter tokens that exist on multiple chains
  for (const token of tokens.lsdTokens) {
    const networks = Object.entries(token.addresses)
      .filter(([_, address]) => address && address !== '')
      .map(([network]) => network);
    
    if (networks.length > 1) {
      crosschainTokens.push({
        ...token,
        networks,
      });
    }
  }
  
  logger.info(`Found ${crosschainTokens.length} LSD tokens available on multiple chains`);
  
  return crosschainTokens;
};

// Get the price of a token on multiple chains
const getPricesAcrossChains = async (token) => {
  try {
    logger.info(`Getting prices for ${token.symbol} across chains`);
    
    const prices = {};
    
    for (const network of token.networks) {
      try {
        const tokenAddress = token.addresses[network];
        if (!tokenAddress) continue;
        
        const price = await defiUtils.getTokenPrice(tokenAddress, network);
        prices[network] = price;
        
        logger.info(`${token.symbol} price on ${network}: ${price.priceInEth} ETH / $${price.priceInUsd}`);
      } catch (error) {
        logger.error(`Failed to get price for ${token.symbol} on ${network}: ${error.message}`);
      }
    }
    
    return prices;
  } catch (error) {
    logger.error(`Failed to get prices across chains: ${error.message}`);
    throw error;
  }
};

// Find arbitrage opportunities between networks
const findArbitrageOpportunities = async () => {
  try {
    logger.info('Finding arbitrage opportunities');
    
    const arbitrageOpportunities = [];
    
    // Get all LSD tokens available on multiple chains
    const crosschainTokens = findCrosschainLSDTokens();
    
    // Check each token
    for (const token of crosschainTokens) {
      logger.info(`Checking ${token.symbol} for arbitrage opportunities`);
      
      // Get prices across chains
      const prices = await getPricesAcrossChains(token);
      
      // Find price differentials
      const priceEntries = Object.entries(prices);
      
      for (let i = 0; i < priceEntries.length; i++) {
        const [sourceNetwork, sourcePrice] = priceEntries[i];
        
        for (let j = i + 1; j < priceEntries.length; j++) {
          const [targetNetwork, targetPrice] = priceEntries[j];
          
          // Calculate price difference in percentage
          const priceDiff = (targetPrice.priceInEth - sourcePrice.priceInEth) / sourcePrice.priceInEth * 100;
          const absPriceDiff = Math.abs(priceDiff);
          
          logger.info(`${token.symbol} price difference between ${sourceNetwork} (${sourcePrice.priceInEth} ETH) and ${targetNetwork} (${targetPrice.priceInEth} ETH): ${priceDiff.toFixed(2)}%`);
          
          // Check if the price difference exceeds our threshold
          if (absPriceDiff >= config.arbitrage.priceDeviationThreshold) {
            // Determine the direction (buy low, sell high)
            const buyNetwork = sourcePrice.priceInEth < targetPrice.priceInEth ? sourceNetwork : targetNetwork;
            const sellNetwork = buyNetwork === sourceNetwork ? targetNetwork : sourceNetwork;
            const buyPrice = prices[buyNetwork];
            const sellPrice = prices[sellNetwork];
            
            // Calculate profitability
            const profitabilityAnalysis = await calculator.calculateProfitability(
              token,
              buyNetwork,
              sellNetwork,
              buyPrice,
              sellPrice,
              config.wallet.maxExposurePerTrade
            );
            
            if (profitabilityAnalysis.isProfitable) {
              arbitrageOpportunities.push({
                token,
                buyNetwork,
                sellNetwork,
                buyPrice,
                sellPrice,
                priceDifference: priceDiff,
                profitability: profitabilityAnalysis,
                timestamp: new Date().toISOString(),
              });
              
              logger.info(`Found profitable arbitrage opportunity for ${token.symbol} between ${buyNetwork} and ${sellNetwork}`);
              logger.info(`Estimated profit: $${profitabilityAnalysis.estimatedProfitUSD}`);
            } else {
              logger.info(`Arbitrage opportunity for ${token.symbol} between ${buyNetwork} and ${sellNetwork} is not profitable`);
              logger.info(`Reason: ${profitabilityAnalysis.reason}`);
            }
          }
        }
      }
    }
    
    logger.info(`Found ${arbitrageOpportunities.length} profitable arbitrage opportunities`);
    
    return arbitrageOpportunities;
  } catch (error) {
    logger.error(`Failed to find arbitrage opportunities: ${error.message}`);
    return [];
  }
};

// Monitor for arbitrage opportunities
const monitorArbitrageOpportunities = async () => {
  try {
    logger.info('Starting arbitrage opportunity monitoring');
    
    // Initialize Web3 connections
    if (!web3Utils.initializeWeb3()) {
      throw new Error('Failed to initialize Web3 connections');
    }
    
    // Check wallet balances
    const balances = await web3Utils.checkWalletBalances();
    
    // Find opportunities
    const opportunities = await findArbitrageOpportunities();
    
    return opportunities;
  } catch (error) {
    logger.error(`Arbitrage monitoring failed: ${error.message}`);
    return [];
  }
};

// Get best arbitrage strategy for a given opportunity
const getBestArbitrageStrategy = async (opportunity) => {
  try {
    logger.info(`Getting best arbitrage strategy for ${opportunity.token.symbol} between ${opportunity.buyNetwork} and ${opportunity.sellNetwork}`);
    
    // Get token addresses
    const tokenAddressBuy = opportunity.token.addresses[opportunity.buyNetwork];
    const tokenAddressSell = opportunity.token.addresses[opportunity.sellNetwork];
    
    // Calculate optimal trade size based on profitability and available balance
    const maxTradeSize = ethers.utils.parseEther(
      Math.min(
        ethers.utils.formatEther(config.wallet.maxExposurePerTrade),
        opportunity.profitability.optimalTradeSize
      ).toString()
    );
    
    // Check if we should use flash loans
    const useFlashLoan = config.arbitrage.flashLoanEnabled && 
      opportunity.profitability.optimalTradeSize > ethers.utils.formatEther(config.wallet.maxExposurePerTrade);
    
    // Calculate gas costs
    const estimatedGasCostsBuy = await swapper.estimateSwapGasCost(
      opportunity.buyNetwork,
      ethers.constants.AddressZero, // ETH
      tokenAddressBuy,
      maxTradeSize
    );
    
    const estimatedGasCostsSell = await swapper.estimateSwapGasCost(
      opportunity.sellNetwork,
      tokenAddressSell,
      ethers.constants.AddressZero, // ETH
      opportunity.profitability.expectedSellAmountWei
    );
    
    // Calculate bridge fees
    const bridgeFee = await bridgesUtils.getBridgeFee(
      opportunity.buyNetwork,
      opportunity.sellNetwork,
      tokenAddressBuy,
      opportunity.profitability.expectedBuyAmountWei
    );
    
    // Get bridge time
    const bridgeTime = bridgesUtils.getBridgingTime(opportunity.buyNetwork, opportunity.sellNetwork);
    
    // Define the strategy
    const strategy = {
      opportunity,
      useFlashLoan,
      tradeSize: maxTradeSize,
      estimatedGasCostsBuy,
      estimatedGasCostsSell,
      bridgeFee,
      bridgeTime,
      steps: [
        {
          step: 1,
          action: 'Buy LSD',
          network: opportunity.buyNetwork,
          details: `Buy ${opportunity.token.symbol} on ${opportunity.buyNetwork} at ${opportunity.buyPrice.priceInEth} ETH`,
        },
        {
          step: 2,
          action: 'Bridge LSD',
          network: opportunity.buyNetwork,
          details: `Bridge ${opportunity.token.symbol} from ${opportunity.buyNetwork} to ${opportunity.sellNetwork}. Estimated time: ${bridgeTime} minutes`,
        },
        {
          step: 3,
          action: 'Sell LSD',
          network: opportunity.sellNetwork,
          details: `Sell ${opportunity.token.symbol} on ${opportunity.sellNetwork} at ${opportunity.sellPrice.priceInEth} ETH`,
        },
        {
          step: 4,
          action: 'Bridge ETH back',
          network: opportunity.sellNetwork,
          details: `Bridge ETH from ${opportunity.sellNetwork} back to ${opportunity.buyNetwork}`,
        }
      ],
      estimatedProfitWei: opportunity.profitability.estimatedProfitWei,
      estimatedProfitETH: opportunity.profitability.estimatedProfitETH,
      estimatedProfitUSD: opportunity.profitability.estimatedProfitUSD,
      estimatedROI: opportunity.profitability.estimatedROI,
      estimatedTime: bridgeTime * 2, // Approximation for round-trip
    };
    
    return strategy;
  } catch (error) {
    logger.error(`Failed to get arbitrage strategy: ${error.message}`);
    throw error;
  }
};

module.exports = {
  findCrosschainLSDTokens,
  getPricesAcrossChains,
  findArbitrageOpportunities,
  monitorArbitrageOpportunities,
  getBestArbitrageStrategy,
};