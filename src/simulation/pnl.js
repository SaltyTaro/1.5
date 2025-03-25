const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
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
    new winston.transports.File({ filename: 'logs/pnl.log' })
  ],
});

// PnL tracking class
class PnLTracker {
  constructor(initialBalanceETH = 10) {
    this.initialBalanceETH = initialBalanceETH;
    this.currentBalanceETH = initialBalanceETH;
    this.trades = [];
    this.pnlHistory = [];
    this.dataDir = path.join(__dirname, '../../data');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    this.pnlFile = path.join(this.dataDir, 'pnl_history.json');
    this.tradesFile = path.join(this.dataDir, 'trades.json');
    
    // Load existing data if available
    this.loadData();
  }
  
  // Load existing data
  loadData() {
    try {
      if (fs.existsSync(this.pnlFile)) {
        const pnlData = JSON.parse(fs.readFileSync(this.pnlFile, 'utf8'));
        this.pnlHistory = pnlData;
        
        // Update current balance if we have historical data
        if (this.pnlHistory.length > 0) {
          this.currentBalanceETH = this.pnlHistory[this.pnlHistory.length - 1].balance;
        }
      }
      
      if (fs.existsSync(this.tradesFile)) {
        this.trades = JSON.parse(fs.readFileSync(this.tradesFile, 'utf8'));
      }
      
      logger.info(`Loaded PnL data: Current balance: ${this.currentBalanceETH} ETH, Total trades: ${this.trades.length}`);
    } catch (error) {
      logger.error(`Failed to load PnL data: ${error.message}`);
    }
  }
  
  // Save data to files
  saveData() {
    try {
      fs.writeFileSync(this.pnlFile, JSON.stringify(this.pnlHistory, null, 2));
      fs.writeFileSync(this.tradesFile, JSON.stringify(this.trades, null, 2));
      
      logger.info('PnL data saved successfully');
    } catch (error) {
      logger.error(`Failed to save PnL data: ${error.message}`);
    }
  }
  
  // Record a new trade execution
  recordTrade(execution) {
    try {
      const timestamp = new Date();
      
      // Create a trade record
      const trade = {
        id: this.trades.length + 1,
        timestamp: timestamp.toISOString(),
        token: execution.strategy.opportunity.token.symbol,
        buyNetwork: execution.strategy.opportunity.buyNetwork,
        sellNetwork: execution.strategy.opportunity.sellNetwork,
        buyPrice: execution.strategy.opportunity.buyPrice.priceInEth,
        sellPrice: execution.strategy.opportunity.sellPrice.priceInEth,
        tradeSize: execution.strategy.tradeSize ? ethers.utils.formatEther(execution.strategy.tradeSize) : '0',
        status: execution.status,
        steps: execution.steps,
        pnl: execution.pnl,
        durationMs: execution.durationMs,
        flashLoan: execution.flashLoan || false,
      };
      
      this.trades.push(trade);
      
      // Update current balance
      if (execution.status === 'success' && execution.pnl) {
        const profit = parseFloat(execution.pnl.netProfitEth);
        this.currentBalanceETH += profit;
        
        // Record PnL history
        this.pnlHistory.push({
          timestamp: timestamp.toISOString(),
          tradeId: trade.id,
          profit,
          balance: this.currentBalanceETH,
          token: execution.strategy.opportunity.token.symbol,
        });
        
        logger.info(`Recorded successful trade: ID ${trade.id}, Profit: ${profit} ETH, New balance: ${this.currentBalanceETH} ETH`);
      } else {
        logger.info(`Recorded unsuccessful trade: ID ${trade.id}, Status: ${execution.status}`);
      }
      
      // Save data
      this.saveData();
      
      return trade;
    } catch (error) {
      logger.error(`Failed to record trade: ${error.message}`);
      throw error;
    }
  }
  
  // Get PnL summary
  getSummary() {
    try {
      // Calculate aggregate statistics
      const totalTrades = this.trades.length;
      const successfulTrades = this.trades.filter(t => t.status === 'success').length;
      const failedTrades = totalTrades - successfulTrades;
      
      let totalProfit = 0;
      let totalGasCost = 0;
      let largestProfit = 0;
      let largestLoss = 0;
      
      for (const trade of this.trades) {
        if (trade.pnl) {
          const profit = parseFloat(trade.pnl.netProfitEth);
          const gasCost = parseFloat(trade.pnl.gasUsedEth);
          
          totalProfit += profit;
          totalGasCost += gasCost;
          
          if (profit > largestProfit) largestProfit = profit;
          if (profit < largestLoss) largestLoss = profit; // Will be negative for losses
        }
      }
      
      // Calculate win rate
      const winRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
      
      // Calculate ROI
      const roi = ((this.currentBalanceETH - this.initialBalanceETH) / this.initialBalanceETH) * 100;
      
      // Get performance by token
      const tokenPerformance = {};
      for (const trade of this.trades) {
        if (trade.pnl && trade.token) {
          if (!tokenPerformance[trade.token]) {
            tokenPerformance[trade.token] = {
              trades: 0,
              successfulTrades: 0,
              totalProfit: 0,
            };
          }
          
          tokenPerformance[trade.token].trades++;
          
          if (trade.status === 'success') {
            tokenPerformance[trade.token].successfulTrades++;
            tokenPerformance[trade.token].totalProfit += parseFloat(trade.pnl.netProfitEth);
          }
        }
      }
      
      // Get performance by network pair
      const networkPerformance = {};
      for (const trade of this.trades) {
        if (trade.pnl && trade.buyNetwork && trade.sellNetwork) {
          const networkPair = `${trade.buyNetwork}-${trade.sellNetwork}`;
          
          if (!networkPerformance[networkPair]) {
            networkPerformance[networkPair] = {
              trades: 0,
              successfulTrades: 0,
              totalProfit: 0,
            };
          }
          
          networkPerformance[networkPair].trades++;
          
          if (trade.status === 'success') {
            networkPerformance[networkPair].successfulTrades++;
            networkPerformance[networkPair].totalProfit += parseFloat(trade.pnl.netProfitEth);
          }
        }
      }
      
      return {
        initialBalance: this.initialBalanceETH,
        currentBalance: this.currentBalanceETH,
        totalTrades,
        successfulTrades,
        failedTrades,
        winRate: `${winRate.toFixed(2)}%`,
        totalProfit: totalProfit.toFixed(4),
        totalGasCost: totalGasCost.toFixed(4),
        netProfit: (totalProfit - totalGasCost).toFixed(4),
        roi: `${roi.toFixed(2)}%`,
        largestProfit: largestProfit.toFixed(4),
        largestLoss: largestLoss.toFixed(4),
        tokenPerformance,
        networkPerformance,
      };
    } catch (error) {
      logger.error(`Failed to generate PnL summary: ${error.message}`);
      throw error;
    }
  }
  
  // Get detailed trade history
  getTradeHistory(limit = 10, offset = 0) {
    try {
      // Sort trades by timestamp in descending order
      const sortedTrades = [...this.trades].sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      // Apply pagination
      return {
        total: sortedTrades.length,
        limit,
        offset,
        trades: sortedTrades.slice(offset, offset + limit),
      };
    } catch (error) {
      logger.error(`Failed to get trade history: ${error.message}`);
      throw error;
    }
  }
  
  // Reset PnL tracker
  reset() {
    try {
      this.currentBalanceETH = this.initialBalanceETH;
      this.trades = [];
      this.pnlHistory = [];
      
      // Save empty data
      this.saveData();
      
      logger.info('PnL tracker reset successfully');
    } catch (error) {
      logger.error(`Failed to reset PnL tracker: ${error.message}`);
      throw error;
    }
  }
}

module.exports = {
  PnLTracker,
};