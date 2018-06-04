const timing = (window.performance && window.performance.timing) || {};
const navigation = (window.performance && window.performance.navigation) || {};

//重定向次数
const redirectCount = navigation && navigation.redirectCount;

// 跳转耗时
const redirect = timing.redirectEnd - timing.redirectStart;

// APP CACHE 耗时
const appcache = Math.max(timing.domainLookupStart - timing.fetchStart, 0);

// DNS 解析耗时
const dns = timing.domainLookupEnd - timing.domainLookupStart;

// TCP 链接耗时
const conn = timing.connectEnd - timing.connectStart;

// 等待服务器响应耗时（注意是否存在cache）
const request = timing.responseStart - timing.requestStart;

// 内容加载耗时（注意是否存在cache）
const response = timing.responseEnd - timing.responseStart;

// 总体网络交互耗时，即开始跳转到服务器资源下载完成：
const network = timing.responseEnd - timing.navigationStart;

// 渲染处理：
const processing = (timing.domComplete || timing.domLoading) - timing.domLoading;

// 抛出 load 事件：
const load = timing.loadEventEnd - timing.loadEventStart;

// 总耗时：
const total = (timing.loadEventEnd || timing.loadEventStart || timing.domComplete || timing.domLoading) - timing.navigationStart;

// 可交互：
const active = timing.domInteractive - timing.navigationStart;

// 请求响应耗时，即 T0，注意cache：
const t0 = timing.responseStart - timing.navigationStart;

// 首次出现内容，即 T1：
const t1 = timing.domLoading - timing.navigationStart;

// 内容加载完毕，即 T3：
const t3 = timing.loadEventEnd - timing.navigationStart;

module.exports = {
    redirectCount,
    redirect,
    appcache,
    dns,
    conn,
    request,
    response,
    network,
    processing,
    load,
    total,
    active,
    t0,
    t1,
    t3
};
