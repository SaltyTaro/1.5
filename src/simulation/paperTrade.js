const { ethers } = require('ethers');
const config = require('../../config/config');
const tokens = require('../../config/tokens');
const web3Utils = require('../utils/web3');
const finder = require('../arbitrage/finder');
const executor = require('../arbitrage/executor');
const { PnLTracker } = require('./pnl');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/paper_trade.log' })
  ],
});

// Create PnL tracker
const pnlTracker = new PnLTracker(10); // Start with 10 ETH

// Run paper trading
const runPaperTrading = async (iterations = 10, sleepTimeMs = 5000) => {
  try {
    logger.info(`Starting paper trading for ${iterations} iterations`);
    
    // Initialize Web3 connections
    if (!web3Utils.initializeWeb3()) {
      throw new Error('Failed to initialize Web3 connections');
    }
    
    // Tracking iterations
    for (let i = 0; i < iterations; i++) {
      logger.info(`Paper trading iteration ${i + 1}/${iterations}`);
      
      // Find arbitrage opportunities
      const opportunities = await finder.findArbitrageOpportunities();
      
      if (opportunities.length === 0) {
        logger.info('No arbitrage opportunities found in this iteration');
      } else {
        // Sort opportunities by estimated profit
        const sortedOpportunities = opportunities.sort((a, b) => 
          parseFloat(b.profitability.estimatedProfitUSD) - parseFloat(a.profitability.estimatedProfitUSD)
        );
        
        // Log top opportunities
        logger.info(`Found ${opportunities.length} arbitrage opportunities`);
        logger.info(`Top opportunity: ${sortedOpportunities[0].token.symbol} between ${sortedOpportunities[0].buyNetwork} and ${sortedOpportunities[0].sellNetwork}`);
        logger.info(`Estimated profit: $${sortedOpportunities[0].profitability.estimatedProfitUSD}`);
        
        // Get best strategy for top opportunity
        const bestStrategy = await finder.getBestArbitrageStrategy(sortedOpportunities[0]);
        
        // Execute paper trade
        const execution = await executor.executeArbitrageStrategy(bestStrategy, true); // true = simulate
        
        // Record trade
        pnlTracker.recordTrade(execution);
        
        // Log execution result
        if (execution.status === 'success') {
          logger.info(`Paper trade execution successful: ${execution.pnl.netProfitEth} ETH profit`);
        } else {
          logger.info(`Paper trade execution failed: ${execution.error}`);
        }
      }
      
      // Sleep between iterations
      if (i < iterations - 1) {
        logger.info(`Sleeping for ${sleepTimeMs / 1000} seconds before next iteration`);
        await new Promise(resolve => setTimeout(resolve, sleepTimeMs));
      }
    }
    
    // Generate and print summary
    const summary = pnlTracker.getSummary();
    
    logger.info('=== Paper Trading Summary ===');
    logger.info(`Initial Balance: ${summary.initialBalance} ETH`);
    logger.info(`Current Balance: ${summary.currentBalance} ETH`);
    logger.info(`Total Trades: ${summary.totalTrades}`);
    logger.info(`Successful Trades: ${summary.successfulTrades}`);
    logger.info(`Failed Trades: ${summary.failedTrades}`);
    logger.info(`Win Rate: ${summary.winRate}`);
    logger.info(`Total Profit: ${summary.totalProfit} ETH`);
    logger.info(`Total Gas Cost: ${summary.totalGasCost} ETH`);
    logger.info(`Net Profit: ${summary.netProfit} ETH`);
    logger.info(`ROI: ${summary.roi}`);
    
    return summary;
  } catch (error) {
    logger.error(`Paper trading failed: ${error.message}`);
    throw error;
  }
};

// Function to analyze trade history
const analyzeTradeHistory = () => {
  try {
    logger.info('Analyzing trade history');
    
    // Get trade history
    const history = pnlTracker.getTradeHistory(100, 0); // Get last 100 trades
    
    // Get summary
    const summary = pnlTracker.getSummary();
    
    // Log token performance
    logger.info('=== Token Performance ===');
    for (const [token, performance] of Object.entries(summary.tokenPerformance)) {
      logger.info(`${token}: ${performance.trades} trades, ${performance.successfulTrades} successful, ${performance.totalProfit.toFixed(4)} ETH profit`);
    }
    
    // Log network performance
    logger.info('=== Network Pair Performance ===');
    for (const [networkPair, performance] of Object.entries(summary.networkPerformance)) {
      logger.info(`${networkPair}: ${performance.trades} trades, ${performance.successfulTrades} successful, ${performance.totalProfit.toFixed(4)} ETH profit`);
    }
    
    // Analyze hourly distribution
    const hourlyDistribution = {};
    for (let i = 0; i < 24; i++) {
      hourlyDistribution[i] = { count: 0, profit: 0 };
    }
    
    for (const trade of history.trades) {
      if (trade.timestamp) {
        const hour = new Date(trade.timestamp).getHours();
        hourlyDistribution[hour].count++;
        
        if (trade.pnl && trade.pnl.netProfitEth) {
          hourlyDistribution[hour].profit += parseFloat(trade.pnl.netProfitEth);
        }
      }
    }
    
    // Log hourly distribution
    logger.info('=== Hourly Distribution ===');
    for (let i = 0; i < 24; i++) {
      if (hourlyDistribution[i].count > 0) {
        logger.info(`Hour ${i}: ${hourlyDistribution[i].count} trades, ${hourlyDistribution[i].profit.toFixed(4)} ETH profit`);
      }
    }
    
    return {
      summary,
      hourlyDistribution,
    };
  } catch (error) {
    logger.error(`Failed to analyze trade history: ${error.message}`);
    throw error;
  }
};

// Main function for running paper trading
const main = async () => {
  try {
    logger.info('Starting paper trading simulation');
    
    // Number of iterations to run
    const iterations = process.env.ITERATIONS ? parseInt(process.env.ITERATIONS) : 20;
    
    // Time between iterations (in ms)
    const sleepTime = process.env.SLEEP_TIME ? parseInt(process.env.SLEEP_TIME) : 5000;
    
    // Run paper trading
    const tradingSummary = await runPaperTrading(iterations, sleepTime);
    
    // Analyze results
    const analysis = analyzeTradeHistory();
    
    // Print final summary
    console.log('======================================');
    console.log('        PAPER TRADING RESULTS         ');
    console.log('======================================');
    console.log(`Initial Balance: ${tradingSummary.initialBalance} ETH`);
    console.log(`Final Balance:   ${tradingSummary.currentBalance} ETH`);
    console.log(`Net Profit:      ${tradingSummary.netProfit} ETH`);
    console.log(`ROI:             ${tradingSummary.roi}`);
    console.log(`Total Trades:    ${tradingSummary.totalTrades}`);
    console.log(`Win Rate:        ${tradingSummary.winRate}`);
    console.log('======================================');
    
    return {
      tradingSummary,
      analysis,
    };
  } catch (error) {
    logger.error(`Paper trading simulation failed: ${error.message}`);
    console.error('Paper trading simulation failed:', error.message);
    process.exit(1);
  }
};

// Allow direct execution
if (require.main === module) {
  main()
    .then(() => {
      logger.info('Paper trading completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`Paper trading failed: ${error.message}`);
      process.exit(1);
    });
} else {
  // Export for use as a module
  module.exports = {
    runPaperTrading,
    analyzeTradeHistory,
    pnlTracker,
  };
}