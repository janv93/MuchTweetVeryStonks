const dotenv = require('dotenv');
if (dotenv) { dotenv.config(); }
const crypto = require('crypto');
const axios = require('axios');

const interval = 7 * 1000;  // ms
let twitterCallInterval;

let currentBitcoinPosition = 0;
let currentDogePosition = 0;

main();

function main() {
  twitterCallInterval = setInterval(() => {
    checkTwitter().then(res => {
      const data = res.data.data;
      const newTweet = getNewTweet(data);

      if (newTweet) {
        processTweet(newTweet.text);
      }
    }).catch(err => handleError());
  }, interval);
}

function checkTwitter() {
  console.log('Checking Twitter...');

  const options = {
    headers: {
      Authorization: 'Bearer ' + process.env.twitter_bearer_token
    }
  };

  // elon: 44196397
  return axios.get('https://api.twitter.com/2/users/44196397/tweets?exclude=retweets,replies&tweet.fields=created_at', options);
}

function getNewTweet(tweets) {
  const newTweets = tweets.filter(tweet => {
    const date = new Date(tweet.created_at);
    const now = new Date();

    const timeDiff = Math.abs(date - now);

    if (timeDiff <= interval * 2) {
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
    const threshold = 0.5;   // set threshold to 0.5%
    const increaseGreaterThanThreshold = increase > threshold;

    if (!increaseGreaterThanThreshold) {
      console.log('Price increase not high enough yet');
      recursivePriceCheck(lastClose);
    } else {
      console.log('Price increase threshold reached, placing order');
      setLeverage(10).then(() => {
        openLongCloseShort(symbol + 'USDT').then(res => {
          sellAtPeak(symbol);
        }).catch(err => handleError(err));
      }).catch(err => handleError(err));
    }
  }).catch(err => handleError(err));
}

function sellAtPeak(symbol) {

}

function getCandlesticks(symbol) {
  return axios.get('https://fapi.binance.com/fapi/v1/indexPriceKlines?pair=' + symbol + '&interval=1m&limit=3');
}

function getPrice(symbol) {
  return axios.get('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + symbol);
}

function setLeverage(leverage) {
  const now = Date.now();

  const query = 'symbol=' + 'BTCUSDT' + '&leverage=' + leverage + '&timestamp=' + now;
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
  return createOrder(symbol, 'BUY', false);
}

function openShortCloseLong(symbol) {
  return createOrder(symbol, 'SELL', true);
}

function createOrder(symbol, side) {
  const now = Date.now();
  const quantityBitcoin = 20;
  const quantityDoge = 0.001;

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
  console.log(err.config.url);

  if (err.response && err.response.data) {
    console.log(err.response.data);
  } else {
    console.log(err);
  }
}