import NodeCache from "node-cache";

const cache = new NodeCache({
  stdTTL: 60,      // cache for 60 seconds
  checkperiod: 120 // cleanup interval
});

export default cache;
