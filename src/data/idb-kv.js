/**
 * 极简 IndexedDB 键值存储（每个库一个对象仓库，外部键）。
 *
 * 用于 localStorage 装不下的数据：CDN 数据缓存（loader.js）、模拟记录（sim-history.js）。
 * 值以结构化克隆保存，调用方需传入纯数据（Alpine 响应式代理不可克隆）。
 * 非浏览器环境（Node 测试 / 脚本）没有 indexedDB：读取返回 undefined，写入 / 删除为空操作。
 */

/**
 * @param {string} dbName
 * @param {string} [storeName='kv']
 */
export function createIdbKv(dbName, storeName = 'kv') {
  let dbPromise = null;
  const available = () => typeof indexedDB !== 'undefined';

  function open() {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => {
        const db = req.result;
        // 其他标签页升级库版本时让出连接，下次访问重新打开
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror   = () => reject(req.error);
      req.onblocked = () => reject(new Error(`IndexedDB「${dbName}」被其他标签页占用`));
    }).catch(err => { dbPromise = null; throw err; });
    return dbPromise;
  }

  /** 在单个事务中执行一次请求，事务提交后返回请求结果 */
  async function run(mode, makeRequest) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, mode);
      const req = makeRequest(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror    = () => reject(tx.error ?? req.error);
      tx.onabort    = () => reject(tx.error ?? new Error(`IndexedDB「${dbName}」事务中止`));
    });
  }

  return {
    available,
    get:  key => available() ? run('readonly',  s => s.get(key))          : Promise.resolve(undefined),
    set:  (key, value) => available() ? run('readwrite', s => s.put(value, key)) : Promise.resolve(),
    del:  key => available() ? run('readwrite', s => s.delete(key))       : Promise.resolve(),
    keys: () => available() ? run('readonly',  s => s.getAllKeys())       : Promise.resolve([]),
  };
}
