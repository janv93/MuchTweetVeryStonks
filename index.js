const express = require('express');
const dotenv = require('dotenv');
if (dotenv) { dotenv.config(); }
const crypto = require('crypto');
const axios = require('axios');

const tweetCheckInterval = 5 * 1000;  // interval for checking tweets
const waitingTimeout = 2 * 60 * 1000 // timeout for waiting after position opens, we can assume the price will go up for some time, makes sure we dont sell too early
const thresholdIncrease = 0.5   // threshold in percent (price increase since last 1 minute close) at which a position is placed; makes sure the tweet does not have negative impact on price
/**
 * threshold in percent; price decrease since last peak relative to peak - close of position opening price
 * e.g. musk tweets and position opens at 0.3$, price then goes up to 0.45$, and then down to 0.4$
 * the decrease will be 0.45-0.4 = 0.05
 * the max-min is 0.45-0.3 = 0.15
 * the decrease is 0.05 / 0.15 = 0.33
 * if threshold is 0.4, the price will have to further drop, if it is 0.3, the position will be closed and profit taken
 */
const thresholdFall = 30;
const quantityDoge = 100; // amount of doge to open and close position
const leverage = 50;  // leverage to open and close position
const userId = '44196397' // twitter ID to check for tweets, Elon: '44196397', has to be string for larger IDs
const restartTimeout = 60 * 60 * 1000 // timeout to restart the program after closing position, this should be at least some minutes since the price is unlikely to peak right after it peaked

const quantityBitcoin = 0.001;  // future feature: amount of bitcoin to open and close position

let twitterCallInterval;
let currentBitcoinPosition = 0;
let currentDogePosition = 0;
let recursiveChecksDone = 0;

const app = express();
app.listen('port', process.env.PORT || 3000);
app.get('/', (req, res) => {
  res.send('App is running');
  main();
});

function main() {
  twitterCallInterval = setInterval(() => {
    checkTwitter().then(res => {
      const data = res.data.data;
      const newTweet = getNewTweet(data);

      if (newTweet) {
        processTweet(newTweet.text);
      }
    }).catch(err => handleError(err));
  }, tweetCheckInterval);
}

function checkTwitter() {
  console.log('Checking Twitter...');

  const options = {
    headers: {
      Authorization: 'Bearer ' + process.env.twitter_bearer_token
    }
  };

  return axios.get('https://api.twitter.com/2/users/' + userId + '/tweets?exclude=retweets,replies&tweet.fields=created_at', options);
}

function getNewTweet(tweets) {
  const newTweets = tweets.filter(tweet => {
    const date = new Date(tweet.created_at);
    const now = new Date();

    const timeDiff = Math.abs(date - now);

    if (timeDiff <= tweetCheckInterval * 4) {   // * 4 because twitter api is slow sometimes
      return true;
    }
  });

  return newTweets.length > 0 ? newTweets[0] : null;
}

function processTweet(tweet) {
  const message = tweet.toLowerCase();
  const dogeSignals = ['doge'];
  const btcSignals = ['btc', 'bitcoin'];

  const containsDoge = dogeSignals.find(signal => {
    return message.includes(signal);
  });

  const containsBtc = btcSignals.find(signal => {
    return message.includes(signal);
  });

  if (containsDoge) {
    clearInterval(twitterCallInterval);   // stop twitter calls
    processBinance('DOGE');
  }

  if (containsBtc) {
    processBinance('BTC');
  }
}

function processBinance(symbol) {
  getCandlesticks(symbol + 'USDT').then(res => {
    const lastStick = res.data[1];   // now - 1 min
    recursivePriceCheck(lastStick[4], symbol);
  }).catch(err => handleError(err));
}

// get price again immediately when server answers
function recursivePriceCheck(lastClose, symbol) {
  getPrice(symbol + 'USDT').then(res => {
    const currentPrice = res.data.indexPrice;
    const priceDiff = currentPrice - lastClose;
    const increase = priceDiff / lastClose * 100;
    const increaseGreaterThanThreshold = increase > thresholdIncrease;  // currently only checks if price is increasing TODO: for Bitcoin also check if price is decreasing

    if (!increaseGreaterThanThreshold) {
      console.log('Price increase not high enough yet');
      recursiveChecksDone ++;
      if (recursiveChecksDone < 200) {
        recursivePriceCheck(lastClose, symbol);
      }
    } else {
      console.log('Price increase threshold reached, placing order');

      // Doge algorithm: buy if price confirms, wait for the peak and sell
      if (symbol === 'DOGE') {
        setLeverage(symbol, leverage).then(() => {
          openLongCloseShort(symbol + 'USDT').then(res => {
            sellDogeAtPeak(lastClose);
          }).catch(err => handleError(err));
        }).catch(err => handleError(err));
      }

      // Bitcoin Algorithm: check what direction Bitcoin is moving in, buy that direction, wait for peak and sell
      if (symbol === 'BITCOIN') {
        // optional future feature
      }
    }
  }).catch(err => handleError(err));
}

// wait for doge to reach peak and drop a percate to be sold
function sellDogeAtPeak(lastClose) {
  let peak = 0;

  console.log();
  console.log('Waiting for price to go up');
  console.log();
  // wait 2 minutes before doing anything
  setTimeout(() => {
    // check every 5 seconds if price dropped significantly yet, then close position
    const peakInterval = setInterval(() => {
      getPrice('DOGEUSDT').then(res => {
        const currentPrice = res.data.indexPrice;
  
        if (currentPrice > peak) {
          peak = currentPrice;
          console.log('new peak at ' + peak);
        }
  
        console.log('lastClose ' + lastClose);
        const priceDiffPeakToCurrent = peak - currentPrice;
        console.log('priceDiffPeakToCurrent ' + priceDiffPeakToCurrent);
        const priceDiffPeakToBottom = peak - lastClose;
        console.log('priceDiffPeakToBottom ' + priceDiffPeakToBottom);
        const percentageFall = priceDiffPeakToCurrent / priceDiffPeakToBottom;
        console.log('percentageFall ' + percentageFall);
        console.log();

        if (percentageFall > thresholdFall / 100) {
          openShortCloseLong('DOGEUSDT');
          clearInterval(peakInterval);
        }

        if (priceDiffPeakToBottom < 0) {
          console.log('unexpected price drop in waitingTimeout, closing short');
          openShortCloseLong('DOGEUSDT');
          clearInterval(peakInterval);
        }
  
      }).catch(err => handleError(err));
    }, 5000);
  }, waitingTimeout);
}

function getCandlesticks(symbol) {
  return axios.get('https://fapi.binance.com/fapi/v1/indexPriceKlines?pair=' + symbol + '&interval=1m&limit=3');
}

function getPrice(symbol) {
  return axios.get('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + symbol);
}

function setLeverage(symbol, leverage) {
  const now = Date.now();

  const query = 'symbol=' + symbol + 'USDT' + '&leverage=' + leverage + '&timestamp=' + now;
  const hmac = createHmac(query);

  const options = {
    headers: {
      'X-MBX-APIKEY': process.env.binance_api_key
    }
  };

  const url = 'https://fapi.binance.com/fapi/v1/leverage?' + query + '&signature=' + hmac;

  return axios.post(url, null, options);
}

// Opening a long on market order is the same as closing short and vice versa, if the amount gets the position to 0.
function openLongCloseShort(symbol) {
  return createOrder(symbol, 'BUY');
}

function openShortCloseLong(symbol) {
  return createOrder(symbol, 'SELL').then(() => {
    setTimeout(() => {
      main();
    }, restartTimeout);
  }).catch(err => handleError(err));
}

function createOrder(symbol, side) {
  const now = Date.now();

  let query =
    'symbol=' + symbol
    + '&timestamp=' + now
    + '&side=' + side
    + '&type=' + 'MARKET';

  switch (symbol) {
    case 'BTCUSDT': query += '&quantity=' + quantityBitcoin;
      side === 'BUY' ? currentBitcoinPosition += quantityBitcoin : currentBitcoinPosition -= quantityBitcoin;
      break;
    case 'DOGEUSDT': query += '&quantity=' + quantityDoge;
      side === 'BUY' ? currentDogePosition += quantityDoge : currentDogePosition - quantityDoge;
      break;
  }

  const hmac = createHmac(query);

  const options = {
    headers: {
      'X-MBX-APIKEY': process.env.binance_api_key
    }
  };

  const url = 'https://fapi.binance.com/fapi/v1/order?' + query + '&signature=' + hmac;

  return axios.post(url, null, options);
}

function createHmac(query) {
  return crypto.createHmac('sha256', process.env.binance_api_key_secret).update(query).digest('hex')
}

function handleError(err) {
  if (err.config && err.config.url) {
    console.log(err.config.url);
  }

  if (err.response && err.response.data) {
    console.log(err.response.data);
  } else {
    console.log(err);
  }
}