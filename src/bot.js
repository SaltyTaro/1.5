const { ethers } = require('ethers');
const config = require('../config/config');
const tokens = require('../config/tokens');
const web3Utils = require('./utils/web3');
const finder = require('./arbitrage/finder');
const executor = require('./arbitrage/executor');
const socketUtils = require('./utils/socket');
const { PnLTracker } = require('./simulation/pnl');
const schedule = require('node-schedule');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/bot.log' })
  ],
});

// Create PnL tracker
const pnlTracker = new PnLTracker(10); // Start with 10 ETH (for tracking purposes)

// Bot state
let botState = {
  running: false,
  lastScan: null,
  activeTrade: null,
  recentOpportunities: [],
  totalScans: 0,
  opportunitiesFound: 0,
  tradesExecuted: 0,
  tradesSuccessful: 0,
  tradesFailed: 0,
};

// Start the bot
const startBot = async () => {
  try {
    if (botState.running) {
      logger.info('Bot is already running');
      return;
    }
    
    logger.info('Starting arbitrage bot');
    
    // Initialize Web3 connections
    if (!web3Utils.initializeWeb3()) {
      throw new Error('Failed to initialize Web3 connections');
    }
    
    // Check wallet balances
    await web3Utils.checkWalletBalances();
    
    // Set bot as running
    botState.running = true;
    
    // Schedule regular scans
    const scanInterval = config.arbitrage.monitoringIntervalMs;
    
    logger.info(`Scheduling scans every ${scanInterval / 1000} seconds`);
    
    // Set up scheduled job
    const job = schedule.scheduleJob(`*/${Math.ceil(scanInterval / 1000)} * * * * *`, async () => {
      if (botState.running) {
        try {
          await scanForOpportunities();
        } catch (error) {
          logger.error(`Error during scheduled scan: ${error.message}`);
        }
      }
    });
    
    // Perform initial scan
    await scanForOpportunities();
    
    return { status: 'success', message: 'Bot started successfully' };
  } catch (error) {
    logger.error(`Failed to start bot: ${error.message}`);
    botState.running = false;
    throw error;
  }
};

// Stop the bot
const stopBot = () => {
  try {
    if (!botState.running) {
      logger.info('Bot is already stopped');
      return;
    }
    
    logger.info('Stopping arbitrage bot');
    
    // Cancel all scheduled jobs
    schedule.gracefulShutdown();
    
    // Set bot as stopped
    botState.running = false;
    
    return { status: 'success', message: 'Bot stopped successfully' };
  } catch (error) {
    logger.error(`Failed to stop bot: ${error.message}`);
    throw error;
  }
};

// Scan for arbitrage opportunities
const scanForOpportunities = async () => {
  try {
    if (botState.activeTrade) {
      logger.info('Skip scan: Active trade in progress');
      return;
    }
    
    logger.info('Scanning for arbitrage opportunities');
    
    // Update state
    botState.lastScan = new Date();
    botState.totalScans++;
    
    // Find opportunities
    const opportunities = await finder.findArbitrageOpportunities();
    
    if (opportunities.length === 0) {
      logger.info('No arbitrage opportunities found');
      return;
    }
    
    // Update state
    botState.opportunitiesFound += opportunities.length;
    botState.recentOpportunities = opportunities.map(o => ({
      token: o.token.symbol,
      buyNetwork: o.buyNetwork,
      sellNetwork: o.sellNetwork,
      priceDifference: o.priceDifference.toFixed(2) + '%',
      estimatedProfit: o.profitability.estimatedProfitUSD + ' USD',
      timestamp: new Date(),
    }));
    
    // Sort opportunities by estimated profit
    const sortedOpportunities = opportunities.sort((a, b) => 
      parseFloat(b.profitability.estimatedProfitUSD) - parseFloat(a.profitability.estimatedProfitUSD)
    );
    
    // Log top opportunities
    logger.info(`Found ${opportunities.length} arbitrage opportunities`);
    logger.info(`Top opportunity: ${sortedOpportunities[0].token.symbol} between ${sortedOpportunities[0].buyNetwork} and ${sortedOpportunities[0].sellNetwork}`);
    logger.info(`Estimated profit: $${sortedOpportunities[0].profitability.estimatedProfitUSD}`);
    
    // Check if auto-execution is enabled
    if (process.env.AUTO_EXECUTE === 'true') {
      await executeArbitrage(sortedOpportunities[0]);
    }
  } catch (error) {
    logger.error(`Scan failed: ${error.message}`);
  }
};

// Execute an arbitrage trade
const executeArbitrage = async (opportunity) => {
  try {
    if (botState.activeTrade) {
      logger.info('Cannot execute: Active trade in progress');
      return;
    }
    
    logger.info(`Executing arbitrage for ${opportunity.token.symbol} between ${opportunity.buyNetwork} and ${opportunity.sellNetwork}`);
    
    // Update state
    botState.activeTrade = {
      token: opportunity.token.symbol,
      buyNetwork: opportunity.buyNetwork,
      sellNetwork: opportunity.sellNetwork,
      startTime: new Date(),
      status: 'in_progress',
    };
    
    // Get best strategy
    const strategy = await finder.getBestArbitrageStrategy(opportunity);
    
    // Execute strategy
    let execution;
    if (strategy.useFlashLoan) {
      logger.info('Using flash loan for arbitrage');
      execution = await executor.executeFlashLoanArbitrage(strategy);
    } else {
      logger.info('Using regular arbitrage strategy');
      execution = await executor.executeArbitrageStrategy(strategy);
    }
    
    // Record trade
    pnlTracker.recordTrade(execution);
    
    // Update state
    botState.activeTrade.status = execution.status;
    botState.activeTrade.endTime = new Date();
    botState.activeTrade.profit = execution.pnl?.netProfitEth || '0';
    
    botState.tradesExecuted++;
    if (execution.status === 'success') {
      botState.tradesSuccessful++;
      logger.info(`Trade executed successfully with profit: ${execution.pnl.netProfitEth} ETH`);
    } else {
      botState.tradesFailed++;
      logger.error(`Trade execution failed: ${execution.error}`);
    }
    
    // Clear active trade
    setTimeout(() => {
      botState.activeTrade = null;
    }, 5000);
    
    return execution;
  } catch (error) {
    logger.error(`Trade execution failed: ${error.message}`);
    
    // Update state
    if (botState.activeTrade) {
      botState.activeTrade.status = 'failed';
      botState.activeTrade.endTime = new Date();
      botState.activeTrade.error = error.message;
      
      botState.tradesExecuted++;
      botState.tradesFailed++;
      
      // Clear active trade
      setTimeout(() => {
        botState.activeTrade = null;
      }, 5000);
    }
    
    throw error;
  }
};

// Get bot status
const getBotStatus = () => {
  try {
    const pnlSummary = pnlTracker.getSummary();
    
    return {
      running: botState.running,
      lastScan: botState.lastScan,
      activeTrade: botState.activeTrade,
      stats: {
        totalScans: botState.totalScans,
        opportunitiesFound: botState.opportunitiesFound,
        tradesExecuted: botState.tradesExecuted,
        tradesSuccessful: botState.tradesSuccessful,
        tradesFailed: botState.tradesFailed,
        successRate: botState.tradesExecuted > 0 
          ? (botState.tradesSuccessful / botState.tradesExecuted * 100).toFixed(2) + '%'
          : 'N/A',
      },
      pnl: {
        totalProfit: pnlSummary.netProfit + ' ETH',
        roi: pnlSummary.roi,
        totalTrades: pnlSummary.totalTrades,
      },
      recentOpportunities: botState.recentOpportunities.slice(0, 5), // Show last 5 opportunities
    };
  } catch (error) {
    logger.error(`Failed to get bot status: ${error.message}`);
    return { error: error.message };
  }
};

// Manual scan for opportunities
const manualScan = async () => {
  try {
    logger.info('Manually scanning for arbitrage opportunities');
    
    return await scanForOpportunities();
  } catch (error) {
    logger.error(`Manual scan failed: ${error.message}`);
    throw error;
  }
};

// Manual execution of an opportunity
const manualExecute = async (opportunityIndex = 0) => {
  try {
    if (botState.recentOpportunities.length === 0) {
      throw new Error('No recent opportunities to execute');
    }
    
    if (opportunityIndex >= botState.recentOpportunities.length) {
      throw new Error('Invalid opportunity index');
    }
    
    const recentOpp = botState.recentOpportunities[opportunityIndex];
    logger.info(`Manually executing opportunity: ${recentOpp.token} between ${recentOpp.buyNetwork} and ${recentOpp.sellNetwork}`);
    
    // Find the full opportunity object
    const opportunities = await finder.findArbitrageOpportunities();
    const matchingOpp = opportunities.find(o => 
      o.token.symbol === recentOpp.token && 
      o.buyNetwork === recentOpp.buyNetwork && 
      o.sellNetwork === recentOpp.sellNetwork
    );
    
    if (!matchingOpp) {
      throw new Error('Opportunity is no longer available');
    }
    
    return await executeArbitrage(matchingOpp);
  } catch (error) {
    logger.error(`Manual execution failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  startBot,
  stopBot,
  scanForOpportunities,
  executeArbitrage,
  getBotStatus,
  manualScan,
  manualExecute,
  botState,
  pnlTracker,
};