import { Icon } from "../components/ui/index.js";

const HELP_SECTIONS = [
  {
    icon: "sparkle",
    title: "欢迎使用牛马任务看板",
    bullets: [
      "这里是打工牛马的记事本：记录工作待办、AI 智能建任务、一键生成工作周报。",
      "快速上手三步：① 点侧边栏「新建」创建第一条任务；② 在看板列之间拖拽卡片推进状态；③ 打开「报告」页生成你的周报。",
      "左侧导航：收件箱看动态，我的任务看分工，全部任务看全局，项目看聚合进度。"
    ]
  },
  {
    icon: "board",
    title: "任务看板",
    bullets: [
      "七列状态流：待整理 → 待办 → 进行中 → 待审核 → 已完成，另有阻塞中、已取消两列。",
      "拖拽卡片即可更换状态列，每次状态变更都会记录时间与操作人。",
      "顶部可切换「看板 / 列表」视图，支持按标题、描述、标签搜索与筛选。",
      "横向查看状态列：按住 Ctrl 滚动鼠标滚轮，或触控板双指横滑。"
    ]
  },
  {
    icon: "edit",
    title: "卡片与任务详情",
    bullets: [
      "点击卡片打开详情：编辑标题、描述、优先级、截止日期，指派负责人，添加标签。",
      "子任务：在详情页输入标题即可创建；子任务自动继承父任务的项目与优先级，无需重复选择。",
      "评论区支持回车发送（Shift+Enter 换行）、回复、表情回应与附件上传。",
      "点「关注」后，该任务的动态会进入你的收件箱。"
    ]
  },
  {
    icon: "folder",
    title: "项目",
    bullets: [
      "项目把相关任务聚合在一起，自动统计任务数与完成进度。",
      "项目详情页的「编辑项目」可随时修改名称、图标、描述、优先级、负责人与起止日期。",
      "「资源」页签绑定 Git 仓库（GitHub / GitLab / 通用 Git），绑定后可随时移除。",
      "删除项目不会删除任务，任务只会解除与项目的关联。"
    ]
  },
  {
    icon: "user",
    title: "协作与权限",
    bullets: [
      "任务创建者拥有全部权限；负责人可以修改状态与评论；其他成员只读。",
      "工作区管理员（owner/admin）可以创建任务、删除项目、管理仓库连接。",
      "成员通过邀请加入工作区：管理员在「设置 → 成员」中发起邀请。"
    ]
  },
  {
    icon: "inbox",
    title: "收件箱与周报",
    bullets: [
      "指派、状态变更、评论等动态会进入收件箱，每 15 秒自动刷新。",
      "「报告」页按周期汇总你的任务动态，一键生成工作周报，支持版本留存。"
    ]
  },
  {
    icon: "check",
    title: "快捷键与小贴士",
    bullets: [
      "⌘K：全局搜索（也可点侧边栏「搜索」）。",
      "Ctrl + 鼠标滚轮：在看板中横向滚动状态列。",
      "评论输入框：Enter 发送，Shift+Enter 换行。",
      "卡面除描述外的字段只显示一行，长内容以省略号截断，打开详情可查看完整内容。",
      "系统开启「减少动态效果」后，应用会自动关闭背景动画与毛玻璃，运行更轻快。"
    ]
  }
];

export default function HelpView() {
  return (
    <main className="page overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
        <header>
          <p className="shell-eyebrow">HELP</p>
          <h1 className="text-lg font-semibold text-(--text-primary)">使用帮助</h1>
        </header>
        {HELP_SECTIONS.map((section) => (
          <section key={section.title} className="glass-surface flex flex-col gap-2 rounded-2xl p-5" aria-label={section.title}>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
              <Icon name={section.icon} size={14} className="block text-(--accent)" />
              {section.title}
            </h2>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-5 text-(--text-secondary)">
              {section.bullets.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
