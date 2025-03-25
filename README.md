# Cross-Chain LSD Arbitrage Bot

This is a production-ready arbitrage bot that monitors and executes profitable arbitrage opportunities for Liquid Staking Derivative (LSD) tokens across multiple blockchain networks. The bot looks for price differences of the same LSD token on different chains (e.g., stETH price differences between Arbitrum and Optimism) and executes trades when profitable.

## Features

- **Multi-Chain Support**: Monitors and executes trades across Ethereum, Arbitrum, Optimism, Polygon, and Base networks
- **Automated Arbitrage**: Finds and executes profitable arbitrage opportunities automatically
- **Flash Loan Integration**: Uses flash loans to maximize capital efficiency (optional)
- **MEV Protection**: Options for using private mempools to prevent front-running
- **Gas Optimization**: Optimizes gas costs for each transaction
- **Socket Integration**: Uses Socket Protocol to find the best bridging routes across various cross-chain bridges
- **Across Integration**: Leverages Across Protocol for efficient cross-chain transfers
- **Dynamic Bridge Selection**: Automatically selects the optimal bridging solution based on current conditions
- **Multiple DEXs**: Integrates with Uniswap, Sushiswap, and more
- **Paper Trading**: Simulates trades without risking real funds
- **Profit/Loss Tracking**: Detailed tracking of all trades and profitability
- **Customizable Configuration**: Extensive configuration options

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/cross-chain-lsd-arbitrage.git
cd cross-chain-lsd-arbitrage
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your configuration:
```
# RPC Endpoints
ETH_RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
OPTIMISM_RPC_URL=https://mainnet.optimism.io
POLYGON_RPC_URL=https://polygon-rpc.com
BASE_RPC_URL=https://mainnet.base.org

# Private key (never commit this to version control!)
PRIVATE_KEY=your_private_key_here

# API keys for services
CONNEXT_API_KEY=your_connext_api_key
ACROSS_API_KEY=your_across_api_key

# Bot settings
AUTO_EXECUTE=false
LOG_LEVEL=info
ITERATIONS=20
SLEEP_TIME=5000
```

## Usage

### Running the Bot

Start the bot in monitoring mode (will not execute trades):
```bash
node src/index.js start
```

Get the bot status:
```bash
node src/index.js status
```

Stop the bot:
```bash
node src/index.js stop
```

### Manual Operations

Manually scan for opportunities:
```bash
node src/index.js scan
```

Execute a specific opportunity:
```bash
node src/index.js execute 0  # Executes the first opportunity
```

### Paper Trading

Run paper trading simulation to test the bot without using real funds:
```bash
node src/index.js paper-trade 20 5000  # 20 iterations, 5 seconds between iterations
```

### PnL Tracking

Get PnL summary:
```bash
node src/index.js pnl
```

View trade history:
```bash
node src/index.js history 10 0  # Last 10 trades, starting from offset 0
```

Reset PnL tracker:
```bash
node src/index.js reset-pnl
```

### Help

Display help for all commands:
```bash
node src/index.js help
```

## Configuration

The bot is highly configurable through the `config/config.js` file. Key configurations include:

- **Arbitrage settings**: Minimum profit threshold, maximum slippage, monitoring interval
- **Gas settings**: Gas price strategies
- **Bridge settings**: Which bridges to use
- **Exchange settings**: Which DEXs to use
- **Wallet settings**: Minimum balance requirements, maximum exposure per trade
- **Network settings**: Which networks to monitor

Token addresses are configured in `config/tokens.js`.

## Project Structure

```
arbitrage-bot/
├── config/
│   ├── config.js         # Configuration variables
│   └── tokens.js         # Token addresses across chains
├── src/
│   ├── arbitrage/
│   │   ├── executor.js   # Executes the arbitrage
│   │   ├── finder.js     # Finds arbitrage opportunities
│   │   └── calculator.js # Calculates profitability
│   ├── utils/
│   │   ├── web3.js       # Web3 utilities
│   │   ├── bridges.js    # Bridge utilities
│   │   └── defi.js       # DeFi protocol interactions
│   ├── exchanges/
│   │   ├── connectors.js # Exchange connectors
│   │   └── swapper.js    # Token swapping utilities
│   ├── simulation/
│   │   ├── paperTrade.js # Paper trading simulation
│   │   └── pnl.js        # Profit and loss calculation
│   ├── bot.js            # Main bot logic
│   └── index.js          # Entry point
├── logs/                 # Log files
├── data/                 # Data files (PnL history, etc.)
├── package.json
└── README.md
```

## Safety and Security

- Never share your private keys
- Start with small amounts to test the system
- Test thoroughly with paper trading first
- Be aware of network conditions before executing trades
- Set appropriate profit thresholds to account for gas and bridge costs

## How It Works

1. **Finding Opportunities**: The bot scans for price differences of the same LSD token across different networks.
2. **Calculating Profitability**: For each opportunity, the bot calculates expected profit after accounting for gas costs, bridge fees, and slippage.
3. **Strategy Selection**: The bot determines the optimal trade size and whether to use flash loans.
4. **Execution**: The bot executes the arbitrage in 4 steps:
   - Buy LSD token on the source network
   - Bridge the token to the target network using the optimal route found by Socket Protocol
   - Sell the token on the target network
   - Bridge the proceeds back to the source network
5. **Profit Tracking**: The bot tracks all trades and calculates profitability.

## Socket Protocol Integration

This bot leverages Socket Protocol to find the most efficient bridging routes:

- **Route Optimization**: Socket Protocol analyzes multiple bridges (Connext, Hop, Synapse, etc.) to find the optimal path
- **Fee Estimation**: Accurate fee estimation across different bridges
- **Security**: Reliable and secure cross-chain transfers
- **Fallback Mechanism**: Automatic fallback to Across Protocol if Socket encounters any issues

## Across Protocol Integration

The bot also uses Across Protocol for reliable and efficient transfers:

- **SpokePool Contracts**: Uses the official Across SpokePool contracts for deposits and bridging
- **API-Driven Fees**: Calculates optimal relayer fees using the Across API
- **Bridge Limits**: Automatically checks and respects Across bridge limits
- **Speed-Up Functionality**: Implements deposit speed-up for slow transactions

## Common Arbitrage Scenarios

1. **stETH Arbitrage**: stETH might trade at 0.99 ETH on Arbitrum but 0.975 ETH on Optimism
2. **rETH Arbitrage**: rETH might have a premium on one chain vs another
3. **cbETH Arbitrage**: Similar opportunities exist with Coinbase's staked ETH token
4. **Multi-token Arbitrage**: The bot can find opportunities across different LSD tokens

## Disclaimer

Trading cryptocurrency involves significant risk. This bot is provided as-is with no guarantees of profitability. Always test thoroughly with small amounts and understand the risks involved. The authors are not responsible for any financial losses incurred using this software.

## License

MIT License