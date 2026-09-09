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
      "卡面右下角以水印展示你与卡片的关系（我负责/他人负责/未分派/只读），标题再长也不会遮挡。",
      "子任务：编辑卡片时在「子任务」格点「新建子任务」，默认进入智能创建，父任务自动锁定；手动创建可选。",
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
    title: "协作、团队与角色",
    bullets: [
      "任务创建者拥有全部权限；负责人可编辑与评论，参与人可评论与拖动卡片改状态；其他成员只读。",
      "负责人支持多选；创建者可在「负责人与权限」矩阵中按成员覆盖能力（可指派/可编辑/可评论）。",
      "参与人自动来自本任务子树的负责人，无需手动维护。",
      "任务任何变更（状态、描述、评论、子任务）都会实时同步到所有在线成员，无需手动刷新。",
      "分工角色（项目经理、开发、测试等）描述工作分工，与工作区权限独立；管理员可自定义角色并为成员多选分配。",
      "显示名称与登录用户名分离：在「设置 → 个人资料」或团队页自己一行可修改，所有工作区共用；历史记录保留发生时的名称。",
      "审计日志与团队页「最近操作」会展示具体操作：什么时间、谁、对哪张卡片做了什么——例如“拖动了卡片「周会纪要」（进行中 → 已完成）”“更新了卡片「报表」：描述”。"
    ]
  },
  {
    icon: "inbox",
    title: "收件箱与周报",
    bullets: [
      "指派、状态变更、评论等动态会进入收件箱，每 15 秒自动刷新。",
      "「报告」页按周期汇总你的任务动态（含描述与评论摘要、子任务层级），一键生成工作周报，正文按 Markdown 渲染并支持编辑/预览切换，版本留存。"
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
      "主页面为静态渐变背景，登录页保留动态光束；系统开启「减少动态效果」后，应用会自动降级毛玻璃等视觉效果，运行更轻快。"
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
