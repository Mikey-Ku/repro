/** Shared stylesheet block for the examples gallery, appended to the layout's base styles. */
export const EXAMPLE_STYLES = `
  .gallery { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
  .example-card { border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; background: #fbfaf8; }
  .example-card h2 { margin: 0 0 6px; }
  .example-card p { margin: 0 0 6px; }
  .example-card .meta { font-size: 13px; color: var(--muted); margin: 0; }
  .toast {
    border: 1px solid #b9d9c9;
    background: var(--accent-soft);
    color: var(--accent-strong);
    border-radius: 10px;
    padding: 12px 16px;
    margin: 0 0 16px;
    font-weight: 600;
  }
  textarea {
    font: inherit;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: #fff;
    color: var(--text);
    width: 100%;
    min-height: 96px;
    resize: vertical;
  }
  textarea:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--accent); }
  .radio-group { display: flex; gap: 18px; flex-wrap: wrap; }
  .radio-group .check { margin: 0; }
  .btn-secondary { background: var(--surface); color: var(--accent-strong); border-color: var(--border); }
  .btn-secondary:hover { background: var(--accent-soft); }
  .btn[aria-disabled="true"] { opacity: 0.65; cursor: not-allowed; }
  .folders { display: flex; gap: 6px; margin: 0 0 16px; padding: 0; }
  .folders a { padding: 6px 12px; border-radius: 999px; text-decoration: none; color: var(--muted); border: 1px solid transparent; }
  .folders a[aria-current="page"] { background: var(--accent-soft); color: var(--accent-strong); border-color: #b9d9c9; }
  .inbox-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .inbox-head h2 { margin: 0; }
  .inbox-head .btn { width: auto; padding: 8px 14px; }
  .messages { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
  .messages li { padding: 12px 4px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: 150px 1fr auto; gap: 12px; font-size: 15px; }
  .messages li .who { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .messages li .subject { font-weight: 600; }
  .messages li .snippet { display: block; color: var(--muted); font-size: 13px; }
  .messages li time { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .messages li.empty { display: block; color: var(--muted); }
  @media (max-width: 480px) { .messages li { grid-template-columns: 1fr; } }
  dialog {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    width: min(520px, calc(100vw - 40px));
    box-shadow: 0 10px 30px rgba(20, 24, 30, 0.18);
    color: var(--text);
  }
  dialog::backdrop { background: rgba(20, 24, 30, 0.4); }
  dialog h2 { margin-top: 0; }
  .dialog-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .dialog-actions .btn { width: auto; }
  body[data-page="orders"] main { max-width: 820px; }
  .toolbar { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; align-items: start; margin-bottom: 8px; }
  @media (max-width: 480px) { .toolbar { grid-template-columns: 1fr; } }
  .orders { width: 100%; border-collapse: collapse; font-size: 15px; }
  .orders th, .orders td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); }
  .orders th button { font: inherit; font-weight: 600; background: none; border: 0; padding: 0; color: var(--text); cursor: pointer; }
  .orders th button:hover { text-decoration: underline; }
  .orders .sort-mark { margin-left: 4px; color: var(--muted); }
  .orders td.total { font-variant-numeric: tabular-nums; }
  .orders .unpriced { color: var(--muted); font-style: italic; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #ebe8e2; color: var(--muted); }
  .badge-paid, .badge-shipped { background: var(--accent-soft); color: var(--accent-strong); }
  .badge-refunded { background: var(--danger-soft); color: var(--danger); }
  .pager { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; font-size: 14px; color: var(--muted); }
  .pager .btn { width: auto; padding: 8px 14px; }
  .loading { color: var(--muted); padding: 28px 0; text-align: center; margin: 0; }
  .loading::before {
    content: '';
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    margin-right: 8px;
    vertical-align: -2px;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .steps { list-style: none; display: flex; gap: 8px; padding: 0; margin: 0 0 20px; font-size: 13px; color: var(--muted); }
  .steps li { flex: 1; padding: 6px 0; border-top: 3px solid var(--border); }
  .steps li[aria-current="step"] { border-top-color: var(--accent); color: var(--accent-strong); font-weight: 600; }
  .steps li[data-done="true"] { border-top-color: #b9d9c9; }
`;
