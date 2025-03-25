require('dotenv').config();
const bot = require('./bot');
const paperTrade = require('./simulation/paperTrade');
const { PnLTracker } = require('./simulation/pnl');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/app.log' })
  ],
});

// Available commands
const commands = {
  'start': async () => {
    logger.info('Executing command: start');
    return await bot.startBot();
  },
  'stop': async () => {
    logger.info('Executing command: stop');
    return bot.stopBot();
  },
  'status': async () => {
    logger.info('Executing command: status');
    return bot.getBotStatus();
  },
  'scan': async () => {
    logger.info('Executing command: scan');
    return await bot.manualScan();
  },
  'execute': async (args) => {
    logger.info('Executing command: execute');
    const index = args[0] ? parseInt(args[0]) : 0;
    return await bot.manualExecute(index);
  },
  'paper-trade': async (args) => {
    logger.info('Executing command: paper-trade');
    const iterations = args[0] ? parseInt(args[0]) : 10;
    const sleepTime = args[1] ? parseInt(args[1]) : 5000;
    return await paperTrade.runPaperTrading(iterations, sleepTime);
  },
  'pnl': async () => {
    logger.info('Executing command: pnl');
    return bot.pnlTracker.getSummary();
  },
  'history': async (args) => {
    logger.info('Executing command: history');
    const limit = args[0] ? parseInt(args[0]) : 10;
    const offset = args[1] ? parseInt(args[1]) : 0;
    return bot.pnlTracker.getTradeHistory(limit, offset);
  },
  'reset-pnl': async () => {
    logger.info('Executing command: reset-pnl');
    bot.pnlTracker.reset();
    return { status: 'success', message: 'PnL tracker reset successfully' };
  },
  'help': async () => {
    logger.info('Executing command: help');
    return {
      commands: {
        'start': 'Start the arbitrage bot',
        'stop': 'Stop the arbitrage bot',
        'status': 'Get current bot status',
        'scan': 'Manually scan for arbitrage opportunities',
        'execute [index]': 'Execute a specific opportunity by index (default: 0)',
        'paper-trade [iterations] [sleepTime]': 'Run paper trading simulation',
        'pnl': 'Get PnL summary',
        'history [limit] [offset]': 'Get trade history with pagination',
        'reset-pnl': 'Reset PnL tracker',
        'help': 'Show this help message',
      },
    };
  },
};

// Main function
const main = async () => {
  try {
    logger.info('Starting arbitrage bot application');
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    const cmdArgs = args.slice(1);
    
    // Check if command exists
    if (!commands[command]) {
      console.error(`Unknown command: ${command}`);
      console.log('Use "help" to see available commands');
      process.exit(1);
    }
    
    // Execute command
    const result = await commands[command](cmdArgs);
    
    // Display result
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    
    // Keep running if bot was started
    if (command === 'start') {
      logger.info('Bot is running in the background');
      console.log('Bot is running in the background. Press Ctrl+C to exit.');
    } else {
      process.exit(0);
    }
  } catch (error) {
    logger.error(`Application error: ${error.message}`);
    console.error('Error:', error.message);
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal, shutting down');
  bot.stopBot();
  console.log('Bot stopped. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal, shutting down');
  bot.stopBot();
  console.log('Bot stopped. Exiting...');
  process.exit(0);
});

// Run the application
if (require.main === module) {
  main().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

// Export modules for use as a library
module.exports = {
  bot,
  paperTrade,
  PnLTracker,
};