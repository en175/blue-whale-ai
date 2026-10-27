const SNOWFLAKE_EPOCH = 1_704_067_200_000n;
const MACHINE_ID =
  (process.env.MACHINE_ID ? BigInt(process.env.MACHINE_ID) : 1n) & 0x3ffn;
let lastTs = 0n;
let seq = 0n;

export function nextSnowflake(): bigint {
  const now = BigInt(Date.now()) - SNOWFLAKE_EPOCH;
  if (now === lastTs) {
    seq = (seq + 1n) & 0xfffn;
  } else {
    seq = 0n;
    lastTs = now;
  }
  return (now << 22n) | (MACHINE_ID << 12n) | seq;
}
