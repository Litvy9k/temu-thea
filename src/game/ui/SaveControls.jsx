/**
 * 新游戏 / 存档 / 读档。
 *
 * 放在 game/ 里而不是开发外壳里：外壳将来会丢掉，这三个按钮不会。接进个人站
 * 之后把它摆进站点自己的 chrome 就行，组件本身不关心自己被摆在哪。
 *
 * 存档走「下载文件 + 上传文件」而不是 localStorage：文件是玩家自己拿得走、
 * 备份得了、能发给别人的，而 localStorage 清一次浏览器数据就没了。
 */
import { useRef, useState } from 'react';

import { parseSave, saveFilename, serialize } from '../core/save.ts';
import { t } from '../i18n.js';
import './SaveControls.css';

export default function SaveControls({ getState, onNew, onLoad, lang = 'zh' }) {
  const fileRef = useRef(null);
  const [error, setError] = useState(null);

  const download = () => {
    const state = getState();
    if (!state) return;

    const blob = new Blob([serialize(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = saveFilename(state);
    a.click();

    // 立刻 revoke 会让部分浏览器来不及把内容取走，下一轮事件循环再放
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setError(null);
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    // 必须清空：不清的话选同一个文件第二次不会触发 change，
    // 表现为"读档只能用一次"，而且完全不报错
    e.target.value = '';
    if (!file) return;

    try {
      onLoad(parseSave(await file.text()));
      setError(null);
    } catch (err) {
      setError(`${t(lang, 'loadFailed')}：${err.message}`);
    }
  };

  return (
    <div className="hg-save">
      <button type="button" onClick={onNew}>
        {t(lang, 'newGame')}
      </button>
      <button type="button" onClick={download}>
        {t(lang, 'save')}
      </button>
      <button type="button" onClick={() => fileRef.current?.click()}>
        {t(lang, 'load')}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={pick}
        hidden
      />

      {error && (
        <span className="hg-save__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
