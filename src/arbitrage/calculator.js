const { ethers } = require('ethers');
const config = require('../../config/config');
const tokens = require('../../config/tokens');
const web3Utils = require('../utils/web3');
const defiUtils = require('../utils/defi');
const bridgesUtils = require('../utils/bridges');
const swapper = require('../exchanges/swapper');
const logger = web3Utils.logger;

// Calculate the profitability of an arbitrage opportunity
const calculateProfitability = async (token, buyNetwork, sellNetwork, buyPrice, sellPrice, maxExposureEth) => {
  try {
    logger.info(`Calculating profitability for ${token.symbol} arbitrage between ${buyNetwork} and ${sellNetwork}`);
    
    // Get token addresses
    const tokenAddressBuy = token.addresses[buyNetwork];
    const tokenAddressSell = token.addresses[sellNetwork];
    
    if (!tokenAddressBuy || !tokenAddressSell) {
      return {
        isProfitable: false,
        reason: 'Token not available on one of the networks',
      };
    }
    
    // Calculate price difference
    const priceDiffPercentage = (sellPrice.priceInEth - buyPrice.priceInEth) / buyPrice.priceInEth * 100;
    
    // Convert max exposure to wei
    const maxExposureWei = ethers.utils.parseEther(maxExposureEth.toString());
    
    // Estimate gas costs for buying on source network
    const estimatedGasCostBuy = await estimateGasCost(
      buyNetwork,
      ethers.constants.AddressZero, // ETH
      tokenAddressBuy,
      maxExposureWei
    );
    
    // Calculate how much LSD we can buy with our ETH (accounting for slippage)
    const slippageMultiplier = (100 - config.arbitrage.maxSlippagePercent) / 100;
    const expectedBuyAmount = maxExposureWei.mul(ethers.utils.parseEther(slippageMultiplier.toString())).div(ethers.utils.parseEther(buyPrice.priceInEth.toString()));
    
    // Estimate bridge fees
    const bridgeFee = await bridgesUtils.getBridgeFee(
      buyNetwork,
      sellNetwork,
      tokenAddressBuy,
      expectedBuyAmount
    );
    
    // Calculate how much ETH we'll get from selling on target network
    const expectedSellAmount = expectedBuyAmount.sub(bridgeFee);
    const expectedEthFromSell = expectedSellAmount.mul(ethers.utils.parseEther(sellPrice.priceInEth.toString())).div(ethers.utils.parseEther('1'));
    
    // Estimate gas costs for selling on target network
    const estimatedGasCostSell = await estimateGasCost(
      sellNetwork,
      tokenAddressSell,
      ethers.constants.AddressZero, // ETH
      expectedSellAmount
    );
    
    // Calculate bridge fees for bringing ETH back
    const bridgeBackFee = await bridgesUtils.getBridgeFee(
      sellNetwork,
      buyNetwork,
      ethers.constants.AddressZero, // ETH
      expectedEthFromSell
    );
    
    // Calculate total costs
    const totalCosts = ethers.BigNumber.from(estimatedGasCostBuy.gasCost)
      .add(estimatedGasCostSell.gasCost)
      .add(bridgeBackFee);
    
    // Calculate profit
    const profit = expectedEthFromSell.sub(maxExposureWei).sub(totalCosts);
    
    // Calculate ROI
    const roi = profit.mul(10000).div(maxExposureWei).toNumber() / 100; // Percentage with 2 decimal places
    
    // Calculate profit in USD
    const profitUsd = parseFloat(ethers.utils.formatEther(profit)) * buyPrice.priceInUsd / buyPrice.priceInEth;
    
    // Calculate optimal trade size (where profit is maximized)
    const optimalTradeSize = calculateOptimalTradeSize(
      buyPrice.priceInEth,
      sellPrice.priceInEth,
      estimatedGasCostBuy.gasCost,
      estimatedGasCostSell.gasCost,
      bridgeFee,
      bridgeBackFee
    );
    
    // Check if the opportunity is profitable
    const isProfitable = profit.gt(0) && profitUsd >= config.arbitrage.minProfitThresholdUSD;
    
    // Return the profitability analysis
    return {
      isProfitable,
      priceDiffPercentage,
      expectedBuyAmountWei: expectedBuyAmount,
      expectedBuyAmountToken: ethers.utils.formatEther(expectedBuyAmount),
      expectedSellAmountWei: expectedSellAmount,
      expectedSellAmountToken: ethers.utils.formatEther(expectedSellAmount),
      expectedEthFromSellWei: expectedEthFromSell,
      expectedEthFromSellETH: ethers.utils.formatEther(expectedEthFromSell),
      estimatedGasCostBuy,
      estimatedGasCostSell,
      bridgeFee: ethers.utils.formatEther(bridgeFee),
      bridgeBackFee: ethers.utils.formatEther(bridgeBackFee),
      totalCostsWei: totalCosts,
      totalCostsETH: ethers.utils.formatEther(totalCosts),
      estimatedProfitWei: profit,
      estimatedProfitETH: ethers.utils.formatEther(profit),
      estimatedProfitUSD: profitUsd.toFixed(2),
      estimatedROI: roi,
      optimalTradeSize,
      reason: isProfitable ? 'Profitable' : 'Not enough profit after costs',
    };
  } catch (error) {
    logger.error(`Failed to calculate profitability: ${error.message}`);
    return {
      isProfitable: false,
      reason: `Error: ${error.message}`,
    };
  }
};

// Estimate gas cost for a transaction
const estimateGasCost = async (network, fromToken, toToken, amount) => {
  try {
    return await swapper.estimateSwapGasCost(network, fromToken, toToken, amount);
  } catch (error) {
    logger.error(`Failed to estimate gas cost: ${error.message}`);
    
    // Return a conservative estimate
    return {
      gasEstimate: ethers.BigNumber.from(config.gas.gasLimit),
      gasCost: ethers.BigNumber.from(config.gas.gasLimit).mul(
        config.gas.maxFeePerGas || ethers.utils.parseUnits('30', 'gwei')
      ),
      gasCostEth: ethers.utils.formatEther(
        ethers.BigNumber.from(config.gas.gasLimit).mul(
          config.gas.maxFeePerGas || ethers.utils.parseUnits('30', 'gwei')
        )
      ),
    };
  }
};

// Calculate the optimal trade size for maximum profit
const calculateOptimalTradeSize = (buyPrice, sellPrice, gasCostBuy, gasCostSell, bridgeFee, bridgeBackFee) => {
  try {
    // Convert all inputs to consistent units (ETH)
    const buyPriceEth = parseFloat(buyPrice);
    const sellPriceEth = parseFloat(sellPrice);
    const gasCostBuyEth = parseFloat(ethers.utils.formatEther(gasCostBuy));
    const gasCostSellEth = parseFloat(ethers.utils.formatEther(gasCostSell));
    const bridgeFeeEth = parseFloat(ethers.utils.formatEther(bridgeFee));
    const bridgeBackFeeEth = parseFloat(ethers.utils.formatEther(bridgeBackFee));
    
    // Fixed costs
    const fixedCosts = gasCostBuyEth + gasCostSellEth + bridgeBackFeeEth;
    
    // Variable costs (as a ratio of the trade size)
    const bridgeFeeRatio = bridgeFeeEth / buyPriceEth; // Bridge fee as a ratio of the buy price
    
    // Price difference ratio
    const priceDiffRatio = sellPriceEth / buyPriceEth - 1;
    
    // If the price difference isn't enough to cover variable costs, there's no optimal trade size
    if (priceDiffRatio <= bridgeFeeRatio) {
      logger.info('Price difference not enough to cover variable costs, using minimum trade size');
      return '0.1'; // Minimum trade size
    }
    
    // Calculate optimal trade size
    // The formula is derived from: profit = tradeSize * priceDiffRatio - fixedCosts - tradeSize * bridgeFeeRatio
    // Taking the derivative with respect to tradeSize and setting it to 0 gives us the optimal trade size
    // However, since the formula assumes linear scaling, we'll use a simpler approach
    
    // The optimal trade size is where fixed costs are a small percentage of the total trade
    // A common rule of thumb is when fixed costs are around 1-2% of the trade size
    const optimalTradeSize = fixedCosts / (priceDiffRatio - bridgeFeeRatio) * 50; // Multiplying by 50 means fixed costs are ~2% of trade size
    
    // Cap the trade size at a reasonable amount (e.g., 100 ETH)
    const cappedTradeSize = Math.min(optimalTradeSize, 100);
    
    logger.info(`Calculated optimal trade size: ${cappedTradeSize} ETH`);
    
    return cappedTradeSize.toString();
  } catch (error) {
    logger.error(`Failed to calculate optimal trade size: ${error.message}`);
    return '1'; // Default to 1 ETH
  }
};

// Calculate the PnL for an executed arbitrage
const calculatePnL = (startingBalanceWei, endingBalanceWei, gasUsedWei) => {
  const grossProfitWei = endingBalanceWei.sub(startingBalanceWei);
  const netProfitWei = grossProfitWei.sub(gasUsedWei);
  
  const netProfitEth = ethers.utils.formatEther(netProfitWei);
  const grossProfitEth = ethers.utils.formatEther(grossProfitWei);
  const gasUsedEth = ethers.utils.formatEther(gasUsedWei);
  
  // Calculate ROI
  const roi = startingBalanceWei.gt(0)
    ? netProfitWei.mul(10000).div(startingBalanceWei).toNumber() / 100
    : 0;
  
  return {
    startingBalanceWei,
    startingBalanceEth: ethers.utils.formatEther(startingBalanceWei),
    endingBalanceWei,
    endingBalanceEth: ethers.utils.formatEther(endingBalanceWei),
    grossProfitWei,
    grossProfitEth,
    gasUsedWei,
    gasUsedEth,
    netProfitWei,
    netProfitEth,
    roi: `${roi}%`,
    isProfit: netProfitWei.gt(0),
  };
};

module.exports = {
  calculateProfitability,
  estimateGasCost,
  calculateOptimalTradeSize,
  calculatePnL,
};