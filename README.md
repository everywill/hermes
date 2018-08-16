# Hermas

#### 引入文件
推荐使用npm的方式安装
```
npm i @kaola/hermes -S
```
或者直接cdn获取最新版本
```
<script src="https://haitao.nos.netease.com/hermes.min.0.3.4.js"></script>
```

#### 初始化Hermes

```
const Hermes = require('@kaola/hermes')
Hermes.config('username', options).install()
```
目前options支持以下配置
```
options = {
    appKey: 'somekey', // 系统对应的key
    enable: true, // 不设置时将根据NODE_ENV来判断是否进行数据采集
    sampleRate: 0.5 // 采样率, 默认全部上报
}
```
