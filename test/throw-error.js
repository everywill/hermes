function throwRealError() {
    try {
        throw new Error('realError');
    } catch (e) {
        Hermes.captureException(e);
    }
}

throwRealError();
