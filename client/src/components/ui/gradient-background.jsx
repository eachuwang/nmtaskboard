// 静态渐变背景：替代主页面持续运行的光束动画，零逐帧渲染开销，
// 同时保留柔和的多色晕斑，让毛玻璃仍有可折射的底色。
// 登录页仍使用动态光束（components/ui/beams-background.jsx）。
const LIGHT_GRADIENT = [
  "radial-gradient(58% 72% at 12% 6%, rgba(125, 180, 248, .55), transparent 62%)",
  "radial-gradient(46% 62% at 88% 14%, rgba(103, 211, 232, .45), transparent 66%)",
  "radial-gradient(64% 80% at 68% 96%, rgba(167, 170, 240, .42), transparent 60%)",
  "linear-gradient(165deg, #cfe0f5 0%, #bcd2ec 100%)"
].join(", ");

const DARK_GRADIENT = [
  "radial-gradient(58% 72% at 12% 6%, rgba(64, 116, 200, .35), transparent 62%)",
  "radial-gradient(46% 62% at 88% 14%, rgba(45, 150, 170, .28), transparent 66%)",
  "radial-gradient(64% 80% at 68% 96%, rgba(96, 88, 180, .3), transparent 60%)",
  "linear-gradient(165deg, #101033 0%, #0d0d2b 100%)"
].join(", ");

export function GradientBackground({ dark = false, className = "" }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`.trim()}
      aria-hidden="true"
      style={{ background: dark ? DARK_GRADIENT : LIGHT_GRADIENT }}
    />
  );
}
