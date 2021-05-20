require('dotenv').config();
const axios = require('axios');

const interval = 10;  // seconds

checkTwitter().then(res => {
  const data = res.data;
  const newTweet = getNewTweet(data.data);

  if (newTweet) {
    processTweet(newTweet.text);
  }
}).catch(err => {
  console.log(err.response.data);
});


function checkTwitter () {
  const options = {
    headers: {
      Authorization: 'Bearer ' + process.env.twitter_bearer_token
    }
  };

  return axios.get('https://api.twitter.com/2/users/44196397/tweets?exclude=retweets,replies&tweet.fields=created_at', options);
}

function getNewTweet(tweets) {
  const newTweets = tweets.filter(tweet => {
    const date = new Date(tweet.created_at);
    const now = new Date();

    const timeDiff = Math.abs(date-now) / 1000;
    
    if (timeDiff <= interval) {
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
    return tweet.includes(signal);
  });

  const containsBtc = btcSignals.find(signal => {
    return tweet.includes(signal);
  });

  if (containsDoge) {
    processDoge();
  }

  if (containsBtc) {
    processBtc();
  }
}

function processDoge() {
  console.log('WIP: TODO: add binance connection and algorithm');
}