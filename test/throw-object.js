function throwStringError() {
    // never do this; just making sure Hermes.js handles this case
    // gracefully
    throw { error: 'stuff is broken' };
}

throwStringError();
