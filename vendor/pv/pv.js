const tool = {
    now: () => new Date().getTime()
};

const _wr = function(type) {
    let orig = window.history[type];
    return function() {
        let rv = orig.apply(this, arguments);
        let e = new Event(type.toLowerCase());
        e.arguments = arguments;
        window.dispatchEvent(e);
        return rv;
    };
};

window.history.pushState = _wr('pushState');
window.history.replaceState = _wr('replaceState');

const pageView = (win, reportUrlView) => {
    let startTime;
    let endTime;
    let page;

    function start() {
        // startTime = tool.now();
        page = win.location.href;
        reportUrlView({
            // 必须为 _page 表示一次页面访问
            event: '_page',

            // 页面停留时间，单位毫秒
            duration: endTime - startTime,

            // 页面名称
            tag: page
        });
    }

    function end() {
        // endTime = tool.now();
    }

    // 默认自动启动
    start();

    // 监听 url 变化（包括 hash 变化）
    win.addEventListener('hashchange', (e) => {
        // 页面发生变化，发送一次页面统计
        // end();
        // 再次启动新的统计
        start();
    });

    window.addEventListener('pushstate', (event) => {
        // 页面发生变化，发送一次页面统计
        // end();
        // 再次启动新的统计
        start();
    });
    window.addEventListener('replacestate', (event) => {
        // 页面发生变化，发送一次页面统计
        // end();
        // 再次启动新的统计
        start();
    });

    // 当页面关闭的时候
    /*
    win.addEventListener('beforeunload', () => {
        // 发送一次
        end();
    });
    */
};

module.exports = pageView;
