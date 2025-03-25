require('dotenv').config();
const ethers = require('ethers');

// Handle different ethers versions (v5 vs v6)
const parseUnits = ethers.utils?.parseUnits || ethers.parseUnits;
const formatUnits = ethers.utils?.formatUnits || ethers.formatUnits;
const parseEther = ethers.utils?.parseEther || ethers.parseEther;
const formatEther = ethers.utils?.formatEther || ethers.formatEther;

module.exports = {
  // RPC endpoints
  rpcEndpoints: {
    ethereum: process.env.ETH_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
    arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  },

  // Private keys (NEVER hardcode these in production, use environment variables)
  privateKey: process.env.PRIVATE_KEY,

  // Gas settings
  gas: {
    maxFeePerGas: parseUnits('30', 'gwei'),
    maxPriorityFeePerGas: parseUnits('2', 'gwei'),
    gasLimit: 500000,
  },

  // Arbitrage settings
  arbitrage: {
    minProfitThresholdUSD: 50, // Minimum profit in USD to execute an arbitrage
    maxSlippagePercent: 0.5, // Maximum allowed slippage in percentage
    priceDeviationThreshold: 0.5, // Minimum price deviation to consider (in percentage)
    flashLoanEnabled: true, // Whether to use flash loans
    usePrivateMempool: true, // Whether to use private mempool for MEV protection
    monitoringIntervalMs: 60000, // Check for opportunities every 60 seconds
  },

  // Bridge settings
  bridges: {
    across: {
      enabled: true,
    },
    socket: {
      enabled: true,
      evmxUrl: 'https://rpc-evmx-devnet.socket.tech/',
      apiUrl: 'https://api-evmx-devnet.socket.tech/',
    },
  },

  // Exchange settings (alternatives to 1inch)
  exchanges: {
    uniswap: {
      enabled: true,
      version: 'v3',
    },
    sushiswap: {
      enabled: true,
    },
    curve: {
      enabled: true,
    },
    balancer: {
      enabled: true,
    },
  },

  // Wallet settings
  wallet: {
    minEthBalance: parseEther('0.1'), // Minimum ETH balance to keep for gas
    maxExposurePerTrade: parseEther('5'), // Maximum ETH to use per trade
  },

  // Networks to monitor
  enabledNetworks: ['ethereum', 'arbitrum', 'optimism', 'polygon', 'base'],

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};