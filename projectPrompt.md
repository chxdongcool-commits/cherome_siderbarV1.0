设计输出一份需求文档和开发文档，这个产品是chrome浏览器插件，用户通过这个插件在sidePanel中跟自己的open claw对话。

1. 首先整个项目开发落地的大环境
   1. 一台阿里云的服务器，Linux系统，openclaw也运行在这个服务器，未来相关服务也安装在这个服务器，目前服务器对外放行了18790端口，有其他需求跟我提
   2. 我个人有一台MacBook安装了chrome
2. 先考虑架构设计，要求extension与openclaw是实时连接，但是不能暴露openclaw gateway的端口，可通过relay使用websocket的方式链接extension和openclaw getaway，以达到实时连接的要求；
   1. 设计中需要有详细且最优的架构设计，设计除了要满足需求还需要考虑可管理可迭代
   2. 设计中需要明确实现真正流式输出（块输出模式）的系统交互时序，比如可能涉及的动作：session创建、session.send、sessions.messages.subscribe（订阅流事件）等还有其他必要的session订阅；需要结合extension的特性考虑一些异常场景的处理
3. extension侧的交互要求
   1. 使用chrome侧边栏的形式显示extension，是对话的样式
   2. AI的输出需要是真流式，以块模式输出，避免用户等待AI输出完成后才能看到内容，等待时间过长，基于这个要求需要审查第1步中的架构设计是否满足要求；
   3. 用户关闭侧边栏，再次打开侧边栏时需要连接上一次的会话，并加载上一次会话的内容
   4. AI输出内容的展示要根据markdown的格式进行解析渲染
   5. 会话页面要支持新建会话，新建完成之后要保证会话可以在新的session ID中继续进行
   6. typing indicator也要有，这部分需要详细阅读openclaw的文档
4. 关于真流式输出，需要考虑openclaw gateway中session创建和重连
5. 文档中需要输出项目开发的流程规范：
   1. 项目代码通过GitHub管理
   2. 项目开发过程中的CI/CD集成方案
   3. 代码审查的要求，包括评审维度、输出格式、禁止泛泛而谈等
   4. “所有代码必须具备可观测性（日志 + tracing + request id）”





以下是可能用到的相关文档链接

openclaw.ai WebSocket connect：https://docs.openclaw.ai/concepts/presence#2-websocket-connect

openclaw.ai Event Subscription： https://docs.openclaw.ai/pi#3-event-subscription

openclaw.ai typing indicator：https://docs.openclaw.ai/concepts/typing-indicators#typing-indicators

manifest V3相关文档：https://developer.chrome.com/docs/extensions/reference/api