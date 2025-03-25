// This file contains token addresses and metadata across different chains
// Important for identifying the same asset across multiple networks

module.exports = {
    // Native tokens
    nativeTokens: {
      ethereum: {
        symbol: 'ETH',
        decimals: 18,
      },
      arbitrum: {
        symbol: 'ETH',
        decimals: 18,
      },
      optimism: {
        symbol: 'ETH',
        decimals: 18,
      },
      polygon: {
        symbol: 'MATIC',
        decimals: 18,
      },
      base: {
        symbol: 'ETH',
        decimals: 18,
      },
    },
    
    // Liquid Staking Derivatives (LSDs)
    lsdTokens: [
      {
        name: 'Lido Staked ETH',
        symbol: 'stETH',
        addresses: {
          ethereum: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
          arbitrum: '0x5979D7b546E38E414F7E9822514be443A4800529',
          optimism: '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb',
          polygon: '',
          base: '0xc3864f98f2a61A7cAeb95b039D031b4E2f55e0e9',
        },
        decimals: 18,
        wrappedVersion: {
          symbol: 'wstETH',
          addresses: {
            ethereum: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
            arbitrum: '0x5979D7b546E38E414F7E9822514be443A4800529',
            optimism: '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb',
            polygon: '0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD',
            base: '0xc3864f98f2a61A7cAeb95b039D031b4e2f55e0e9',
          },
          decimals: 18,
        }
      },
      {
        name: 'Rocket Pool ETH',
        symbol: 'rETH',
        addresses: {
          ethereum: '0xae78736Cd615f374D3085123A210448E74Fc6393',
          arbitrum: '0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8',
          optimism: '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D',
          polygon: '',
          base: '0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c',
        },
        decimals: 18,
      },
      {
        name: 'Coinbase Wrapped Staked ETH',
        symbol: 'cbETH',
        addresses: {
          ethereum: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704',
          arbitrum: '0x1DEBd73E752bEaF79865Fd6446b0c970EaE7732f',
          optimism: '0xadDb6A0412DE1BA0F936DCaeb8Aaa24578dcF3B2',
          polygon: '',
          base: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
        },
        decimals: 18,
      },
      {
        name: 'Frax Ether',
        symbol: 'frxETH',
        addresses: {
          ethereum: '0x5E8422345238F34275888049021821E8E08CAa1f',
          arbitrum: '0x178412e79c25968a32e89b11f63B33F733D3725F',
          optimism: '0x6806411765Af15Bddd26f8f544A34cC40cb9838B',
          polygon: '',
          base: '',
        },
        decimals: 18,
      },
      {
        name: 'Staked Frax Ether',
        symbol: 'sfrxETH',
        addresses: {
          ethereum: '0xac3e018457b222d93114458476f3e3416abbe38f',
          arbitrum: '0x95aB45875cFFdba1E5f451B950bC2E42c0053f39',
          optimism: '0x484c2D6e3cDd945a8B2DF735e079178C1036578c',
          polygon: '',
          base: '',
        },
        decimals: 18,
      },
    ],
  
    // Stablecoins for price calculations and conversion
    stablecoins: {
      usdc: {
        symbol: 'USDC',
        addresses: {
          ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          arbitrum: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
          optimism: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
          polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
          base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        },
        decimals: 6,
      },
      dai: {
        symbol: 'DAI',
        addresses: {
          ethereum: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
          arbitrum: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
          optimism: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
          polygon: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
          base: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
        },
        decimals: 18,
      },
    },
    
    // DEX router addresses
    dexRouters: {
      uniswapV3: {
        ethereum: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        arbitrum: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        optimism: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        polygon: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        base: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      },
      sushiswap: {
        ethereum: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
        arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        optimism: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        polygon: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        base: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      },
    },
    
    // Flash loan providers
    flashLoanProviders: {
      aave: {
        ethereum: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
        arbitrum: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        optimism: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        base: '0x39dd7790e75c6f663731f7e1fdc0f35006c35d14',
      },
    },
  };