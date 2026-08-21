/**
 * 运行中那条常驻状态行：现在在做什么、已经等了多久。
 *
 * 用户提交后屏幕会有几十秒没有正文。这几十秒里模型一直在干活，但"在干活"和"已经挂了"
 * 在屏幕上长得一模一样，而这才是真正让人受不了的地方——慢是可以接受的，沉默不行。
 *
 * 这条状态行的定位是**地板**：它不依赖模型吐出任何东西，不依赖产卡成功，也不依赖
 * 事件流还活着。只要这一轮开始了、还没到终态，它就必须在屏幕上，并且秒数一直在走。
 * 上面那些更好看的东西（思考链、卡片逐段长出来）都可能失效，这条不能。
 */
export interface RunStatusInput {
  /** 本轮开始的时刻（毫秒时间戳）。null 表示当前没有进行中的轮次。 */
  activeSince: number | null;
  /** 当前时间（毫秒时间戳）。由调用方按秒推进，便于测试。 */
  now: number;
  /** 最近一个可见节点的描述（来自 run.activity）；还没有任何节点时为 null。 */
  activity: string | null;
  /** 长时间没有任何新进展。 */
  stalled: boolean;
}

export interface RunStatus {
  label: string;
  seconds: number;
  /** stalled 时 UI 换一种语气，但**不会**因此隐藏状态行。 */
  tone: 'working' | 'stalled';
}

/** 还没有收到任何节点时的说法。不编造具体动作，只说明确实在跑。 */
const INITIAL_LABEL = '正在思考';

export function deriveRunStatus({ activeSince, now, activity, stalled }: RunStatusInput): RunStatus | null {
  if (activeSince === null) return null;
  return {
    label: activity ?? INITIAL_LABEL,
    // 起点可能来自事件里的服务端时间，和浏览器时钟未必一致；时钟偏差不该让计时器倒着走。
    seconds: Math.max(0, Math.floor((now - activeSince) / 1000)),
    tone: stalled ? 'stalled' : 'working',
  };
}
