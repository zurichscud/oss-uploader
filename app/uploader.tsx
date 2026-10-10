'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  ReactNode,
} from 'react';

type BucketInfo = { name: string; region: string | null };
type UploadResult = { bucket: string; key: string; url: string; size: number; name: string };
type TaskStatus = 'pending' | 'uploading' | 'done' | 'error';

type Task = {
  id: number;
  file: File;
  name: string;
  size: number;
  status: TaskStatus;
  percent: number;
  writing: boolean;
  bucket: string;
  result: UploadResult | null;
  error: string | null;
};

type HistoryEntry = {
  id: number;
  name: string;
  bucket: string;
  key: string;
  url: string;
  size: number;
  time: number;
};

type FormSnapshot = {
  bucket: string;
  prefix: string;
  buckets: BucketInfo[];
};

export default function Uploader() {
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [bucket, setBucket] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [prefix, setPrefix] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState<number | null>(null);

  const tasksRef = useRef<Task[]>([]);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const dragDepthRef = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formRef = useRef<FormSnapshot>({
    bucket: '',
    prefix: '',
    buckets: [],
  });
  useEffect(() => {
    formRef.current = { bucket, prefix, buckets };
  });

  const syncTasks = useCallback(() => {
    setTasks([...tasksRef.current]);
  }, []);

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, error });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), error ? 6000 : 2600);
  }, []);

  const copyText = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.append(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    setCopied(key);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(null), 1400);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const cfg = await res.json();
        if (cancelled) return;
        setPrefix(cfg.defaultPrefix || '');
        if (typeof cfg.maxFileSizeMb === 'number' && cfg.maxFileSizeMb > 0) {
          setMaxFileSizeMb(cfg.maxFileSizeMb);
        }
        const list: BucketInfo[] = [...(cfg.buckets || [])];
        setBuckets(list);
        setReady(true);
        if (list[0]?.name) setBucket(list[0].name);
        if (cfg.warning) showToast(cfg.warning, true);
      } catch (error) {
        if (!cancelled) {
          setOffline(true);
          showToast(`无法连接本地服务：${(error as Error).message}`, true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || activeIndex < 0) return;
    const option = menuRef.current?.querySelectorAll('.dropdown-option')[activeIndex];
    option?.scrollIntoView({ block: 'nearest' });
  }, [menuOpen, activeIndex]);

  const effectiveBucket = bucket;
  const menuValues = buckets.map((item) => item.name);

  const openMenu = () => {
    if (!ready) return;
    const current = bucket;
    const index = menuValues.indexOf(current);
    setActiveIndex(index > -1 ? index : 0);
    setMenuOpen(true);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setActiveIndex(-1);
  };

  const moveActive = (delta: number) => {
    const count = menuValues.length;
    if (!count) return;
    setActiveIndex((prev) => (prev + delta + count) % count);
  };

  const selectBucket = (value: string) => {
    setBucket(value);
    closeMenu();
  };

  const onDropdownKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!menuOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const value = menuValues[activeIndex];
      if (value) selectBucket(value);
    } else if (event.key === 'Escape') {
      closeMenu();
      toggleRef.current?.focus();
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  };

  const onToggleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (menuOpen) return;
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      openMenu();
    }
  };

  const currentBucket = () => {
    return formRef.current.bucket;
  };

  const uploadTask = useCallback(
    (task: Task, currentPrefix: string) =>
      new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append('bucket', task.bucket);
        form.append('prefix', currentPrefix);
        const info = formRef.current.buckets.find((item) => item.name === task.bucket);
        if (info && info.region) form.append('region', info.region);
        form.append('size', String(task.size));
        form.append('file', task.file);

        xhr.open('POST', '/api/upload');
        xhr.upload.addEventListener('progress', (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          if (percent !== task.percent) {
            task.percent = percent;
            syncTasks();
          }
        });
        xhr.upload.addEventListener('load', () => {
          task.writing = true;
          syncTasks();
        });
        xhr.addEventListener('load', () => {
          let payload: UploadResult | { error?: string } | null = null;
          try {
            payload = JSON.parse(xhr.responseText);
          } catch {
            payload = null;
          }
          if (xhr.status >= 200 && xhr.status < 300 && payload && 'url' in payload) {
            const result = payload as UploadResult;
            task.status = 'done';
            task.writing = false;
            task.percent = 100;
            task.result = result;
            setHistory((prev) =>
              [
                {
                  id: Date.now() + Math.random(),
                  name: result.name,
                  bucket: result.bucket,
                  key: result.key,
                  url: result.url,
                  size: result.size,
                  time: Date.now(),
                },
                ...prev,
              ].slice(0, 100),
            );
          } else {
            task.status = 'error';
            task.error = (payload as { error?: string } | null)?.error || `HTTP ${xhr.status}`;
          }
          syncTasks();
          resolve();
        });
        xhr.addEventListener('error', () => {
          task.status = 'error';
          task.error = '网络错误，无法连接本地服务';
          syncTasks();
          resolve();
        });
        xhr.send(form);
      }),
    [syncTasks],
  );

  const pump = useCallback(async () => {
    if (busyRef.current) return;
    const task = tasksRef.current.find((item) => item.status === 'pending');
    if (!task) return;
    busyRef.current = true;
    const snap = formRef.current;
    task.status = 'uploading';
    task.bucket = snap.bucket;
    task.percent = 0;
    task.writing = false;
    syncTasks();
    await uploadTask(task, snap.prefix);
    busyRef.current = false;
    pump();
  }, [syncTasks, uploadTask]);

  const addFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!currentBucket()) {
      showToast('请先选择目标桶', true);
      return;
    }
    const limitBytes = maxFileSizeMb ? maxFileSizeMb * 1024 * 1024 : 0;
    const accepted = limitBytes ? files.filter((file) => file.size <= limitBytes) : files;
    const skipped = files.length - accepted.length;
    if (!accepted.length) {
      showToast(`已跳过 ${skipped} 个超过 ${maxFileSizeMb} MB 的文件`, true);
      return;
    }
    for (const file of accepted) {
      tasksRef.current.push({
        id: (seqRef.current += 1),
        file,
        name: file.name,
        size: file.size,
        status: 'pending',
        percent: 0,
        writing: false,
        bucket: '',
        result: null,
        error: null,
      });
    }
    syncTasks();
    showToast(
      skipped
        ? `已加入 ${accepted.length} 个文件，跳过 ${skipped} 个超过 ${maxFileSizeMb} MB 的文件`
        : `已加入 ${accepted.length} 个文件`,
      skipped > 0,
    );
    pump();
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files);
    event.target.value = '';
  };

  const retryTask = (task: Task) => {
    if (task.status !== 'error') return;
    task.status = 'pending';
    task.error = null;
    task.percent = 0;
    syncTasks();
    pump();
  };

  const removeTask = (task: Task) => {
    if (task.status === 'uploading') return;
    tasksRef.current = tasksRef.current.filter((item) => item !== task);
    syncTasks();
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const onDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    addFiles(event.dataTransfer.files);
  };

  const panelStyle = (index: number) => ({ '--i': index } as CSSProperties);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <span className="brand-name">
              OSS<i>/</i>UPLOADER
            </span>
            <span className="brand-sub">对象存储上传终端</span>
          </div>
        </div>
        <div className="topbar-meta">
          <span
            className={`chip chip-status${offline ? ' is-bad' : ready ? ' is-ok' : ''}`}
          >
            <i className="dot" />
            <span>{offline ? '离线' : ready ? '就绪' : '连接中'}</span>
          </span>
        </div>
      </header>

      <main>
        <section className="panel config reveal" style={panelStyle(0)}>
          <div className="field">
            <label id="bucketLabel">目标桶 · BUCKET</label>
            <div className="dropdown" ref={dropdownRef} onKeyDown={onDropdownKeyDown}>
              <button
                type="button"
                className="dropdown-toggle"
                ref={toggleRef}
                disabled={!ready}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                aria-labelledby="bucketLabel"
                onClick={() => (menuOpen ? closeMenu() : openMenu())}
                onKeyDown={onToggleKeyDown}
              >
                <span
                  className={`dropdown-value${ready && !effectiveBucket ? ' is-placeholder' : ''}`}
                >
                  {!ready ? '加载中…' : effectiveBucket || (buckets.length ? '请选择目标桶' : '未获取到桶列表')}
                </span>
                <span className="dropdown-chevron" aria-hidden="true" />
              </button>
              {menuOpen && (
                <ul
                  className="dropdown-menu"
                  role="listbox"
                  aria-labelledby="bucketLabel"
                  ref={menuRef}
                >
                  <li className="dropdown-group">buckets · {buckets.length}</li>
                  {buckets.map((item, index) => (
                    <li
                      key={item.name}
                      className={`dropdown-option${index === activeIndex ? ' is-active' : ''}${item.name === bucket ? ' is-selected' : ''}`}
                      role="option"
                      aria-selected={item.name === bucket}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => selectBucket(item.name)}
                    >
                      <CheckIcon />
                      <span className="option-name">{item.name}</span>
                      {item.region && <span className="region">{item.region}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="field grow">
            <label htmlFor="prefixInput">键名前缀 · PREFIX</label>
            <input
              id="prefixInput"
              value={prefix}
              placeholder="可为空，例如 lpgs/case"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setPrefix(event.target.value)}
            />
          </div>

          <div className="field rule">
            <label>键名规则 · KEY RULE</label>
            <code>{'{prefix}/{yyyy}/{MM}/{uuid}.{ext}'}</code>
          </div>
        </section>

        <section className="panel drop-panel reveal" style={panelStyle(1)}>
          <div
            className={`dropzone${dragOver ? ' is-dragover' : ''}`}
            tabIndex={0}
            role="button"
            aria-label="选择或拖拽文件上传"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <div className="drop-inner">
              <span className="drop-glyph" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="square"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </span>
              <p className="drop-title">拖拽文件到此处</p>
              <p className="drop-sub">
                或点击选择文件 · 支持多选 · 串行上传{maxFileSizeMb ? ` · 单个文件 ≤ ${maxFileSizeMb} MB` : ''}
              </p>
            </div>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            className="visually-hidden-input"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={onFileInputChange}
          />
        </section>

        <section className="panel queue-panel reveal" style={panelStyle(2)}>
          <header className="panel-head">
            <h2>上传队列</h2>
            <span className="count">{tasks.length} FILES</span>
          </header>
          <ul className="queue">
            {tasks.map((task) => (
              <li key={task.id}>
                <div className="task-main">
                  <span className="ext">{fileExt(task.name) || 'BIN'}</span>
                  <div className="task-info">
                    <span className="task-name" title={task.name}>
                      {task.name}
                    </span>
                    <span
                      className="task-meta"
                      style={task.status === 'error' ? { color: 'var(--danger)' } : undefined}
                    >
                      {taskMeta(task)}
                    </span>
                  </div>
                  <div className="task-side">
                    <span
                      className={`task-status${task.status === 'done' ? ' ok' : ''}${
                        task.status === 'error' ? ' bad' : ''
                      }`}
                    >
                      {taskStatusText(task)}
                    </span>
                    {task.status === 'error' && (
                      <button type="button" className="mini-btn" onClick={() => retryTask(task)}>
                        重试
                      </button>
                    )}
                    {task.status !== 'uploading' && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="移除"
                        onClick={() => removeTask(task)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={`progress${
                    task.status === 'uploading' && task.writing ? ' indeterminate' : ''
                  }`}
                >
                  <i
                    style={{
                      width:
                        task.status === 'uploading' && task.writing
                          ? '100%'
                          : `${task.percent}%`,
                      background: task.status === 'error' ? 'var(--danger)' : undefined,
                    }}
                  />
                </div>
                {task.status === 'done' && task.result && (
                  <div className="task-result">
                    <code title={`${task.result.bucket}/${task.result.key}`}>
                      {task.result.url}
                    </code>
                    <button
                      type="button"
                      className={`mini-btn${copied === `task-${task.id}` ? ' is-copied' : ''}`}
                      onClick={() => copyText(task.result!.url, `task-${task.id}`)}
                    >
                      {copied === `task-${task.id}` ? '已复制' : '复制链接'}
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => window.open(task.result!.url, '_blank', 'noopener')}
                    >
                      打开
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {tasks.length === 0 && <p className="empty">暂无任务，选择文件后开始上传</p>}
        </section>

        <section className="panel history-panel reveal" style={panelStyle(3)}>
          <header className="panel-head">
            <h2>最近上传</h2>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                if (!history.length) return;
                setHistory([]);
                showToast('已清空上传记录');
              }}
            >
              清空记录
            </button>
          </header>
          <ul className="history">
            {history.map((entry) => (
              <li key={entry.id}>
                <div className="hist-info">
                  <div className="hist-top">
                    <span className="hist-name" title={entry.name}>
                      {entry.name}
                    </span>
                    <span className="hist-time">{formatTime(entry.time)}</span>
                  </div>
                  <span className="hist-key" title={entry.url}>{`${entry.bucket} / ${entry.key}`}</span>
                </div>
                <div className="hist-actions">
                  <button
                    type="button"
                    className={`mini-btn${copied === `hist-${entry.id}` ? ' is-copied' : ''}`}
                    onClick={() => copyText(entry.url, `hist-${entry.id}`)}
                  >
                    {copied === `hist-${entry.id}` ? '已复制' : '复制'}
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => window.open(entry.url, '_blank', 'noopener')}
                  >
                    打开
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {history.length === 0 && <p className="empty">暂无上传记录</p>}
        </section>
      </main>

      {toast && <div className={`toast${toast.error ? ' is-error' : ''}`}>{toast.message}</div>}
    </>
  );
}

function CheckIcon() {
  return (
    <svg className="check" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

function taskMeta(task: Task): ReactNode {
  if (task.status === 'done' && task.result) {
    return `${formatBytes(task.result.size)} · ${task.result.bucket}`;
  }
  if (task.status === 'uploading') {
    return `${formatBytes(task.size)} · ${task.bucket}`;
  }
  if (task.status === 'error') {
    return task.error || '上传失败';
  }
  return formatBytes(task.size);
}

function taskStatusText(task: Task): string {
  if (task.status === 'pending') return '排队中';
  if (task.status === 'done') return '完成';
  if (task.status === 'error') return '失败';
  return task.writing ? '写入 OSS…' : `${task.percent}%`;
}

function fileExt(name: string): string {
  const index = (name || '').lastIndexOf('.');
  if (index <= 0 || index === name.length - 1) return '';
  return name.slice(index + 1).toUpperCase().slice(0, 8);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
