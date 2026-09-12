/**
 * Server-rendered sign-in page for applications that are not SPAs (the Scorecard dashboards). Same two
 * steps and the same words as the Mezza Operations login: work email → 6-digit code → in. The page talks
 * to the JSON endpoints this package mounts, then reloads the URL the person originally asked for.
 */
import { escapeHtml } from "./util.js";
export function renderLoginPage(o) {
    const title = escapeHtml(o.appName);
    const product = escapeHtml(o.productName ?? "Mezza");
    const tagline = escapeHtml(o.tagline ?? "Sign in with your work email. Nothing to remember.");
    const logo = o.logoUrl ? `<img class="logo" src="${escapeHtml(o.logoUrl)}" alt="${product}">` : `<div class="wordmark">${product}</div>`;
    const denied = o.denied
        ? `<div class="card"><div class="eyebrow">Signed in as</div><div class="who">${escapeHtml(o.denied.email)}</div>
       <p class="alert">This account doesn't have access to <strong>${title}</strong>.${o.denied.contact ? ` Ask ${escapeHtml(o.denied.contact)} if you need it.` : ""}</p>
       <button class="btn ghost" id="signout" type="button">Sign out and use a different email</button></div>`
        : "";
    const form = o.denied ? "" : `
  <div class="card" id="card">
    ${o.notice ? `<div class="notice">${escapeHtml(o.notice)}</div>` : ""}
    <form id="f-email">
      <label class="eyebrow" for="email">Work email</label>
      <input id="email" class="input" type="email" inputmode="email" autocomplete="email" autofocus required placeholder="you@mezzarestaurant.com">
      <div class="alert error" id="err1" hidden></div>
      <button class="btn primary" id="b1" type="submit">Send me a code</button>
      <p class="small muted">We'll email you a 6-digit code. It works from any device.</p>
    </form>
    <form id="f-code" hidden>
      <div class="eyebrow">Enter the code sent to</div>
      <div class="who"><span id="shown"></span> <button type="button" class="btn ghost small" id="change">change</button></div>
      <input id="code" class="input code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" required placeholder="••••••">
      <div class="alert error" id="err2" hidden></div>
      <button class="btn primary" id="b2" type="submit" disabled>Sign in</button>
      <button type="button" class="btn ghost" id="resend">Send a new code</button>
      <p class="small muted">Asked twice? Any code from the last 10 minutes works.</p>
    </form>
  </div>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>Sign in · ${title}</title>
<style>
:root{--purple:#54274D;--purple-2:#3E1B39;--ink:#2D1A2B;--muted:#8A7386;--rule:#E8D8E5;--ground:#FAF8F4;--soft:#F5EFF3;--red:#991B1B;--olive:#63692d}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:flex-start;justify-content:center;padding:max(24px,6vh) 16px 40px}
.login{width:100%;max-width:400px;text-align:center}
.logo{height:56px;margin:8px auto 14px;display:block}
.wordmark{font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--purple);font-size:13px;margin:10px 0 14px}
h1{font-size:26px;line-height:1.15;margin:0 0 6px;letter-spacing:-.01em}
.tag{color:var(--muted);font-size:14.5px;margin:0 0 20px}
.card{background:#fff;border:1px solid var(--rule);border-radius:12px;padding:20px 18px;text-align:left;box-shadow:0 8px 30px rgba(84,39,77,.06)}
.eyebrow{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600;display:block;margin-bottom:6px}
.who{font-weight:700;margin-bottom:12px;word-break:break-all}
.input{width:100%;font:inherit;font-size:17px;padding:12px 14px;border:1px solid var(--rule);border-radius:8px;background:#fff;color:var(--ink)}
.input:focus{outline:2px solid var(--purple);outline-offset:1px;border-color:var(--purple)}
.input.code{font-size:30px;letter-spacing:.35em;text-align:center;font-variant-numeric:tabular-nums}
.btn{display:block;width:100%;font:inherit;font-weight:600;padding:12px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;margin-top:12px}
.btn.primary{background:var(--purple);color:#fff}.btn.primary:hover{background:var(--purple-2)}.btn.primary:disabled{opacity:.55;cursor:default}
.btn.ghost{background:transparent;color:var(--purple);border-color:var(--rule);margin-top:8px}
.btn.ghost.small{display:inline;width:auto;padding:2px 8px;font-size:12px;margin:0 0 0 4px;vertical-align:middle}
.alert{border-radius:8px;padding:10px 12px;font-size:14px;margin-top:12px}
.alert.error{background:#F7E4E4;color:var(--red)}
.notice{background:var(--soft);color:var(--purple);border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:12px}
.small{font-size:13px}.muted{color:var(--muted)}p.small{margin:14px 0 0;text-align:center}
[hidden]{display:none!important}
.foot{color:var(--muted);font-size:12px;margin-top:22px}
@media (prefers-color-scheme:dark){:root{--ink:#F2E9EF;--muted:#A48FA0;--rule:#3A2B38;--ground:#191218;--soft:#31212F}.card,.input{background:#221822}.alert.error{background:#3C2222;color:#E58C8C}}
</style></head><body>
<div class="login">
  ${logo}
  <h1>${title}</h1>
  <p class="tag">${tagline}</p>
  ${form}${denied}
  <div class="foot">Mezza internal · sign-in emails come from ${product}</div>
</div>
<script>
(function(){
  var BASE=${JSON.stringify(o.authBase)}, MARK=${JSON.stringify(o.csrfMarker)};
  function post(path, body){return fetch(BASE+path,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-requested-with":MARK},body:JSON.stringify(body||{})}).then(function(r){return r.json().catch(function(){return {}}).then(function(j){j.__status=r.status;return j})})}
  var so=document.getElementById("signout"); if(so){so.onclick=function(){post("/logout").then(function(){location.replace(location.pathname+location.search)})}; return;}
  var fe=document.getElementById("f-email"), fc=document.getElementById("f-code"), email=document.getElementById("email"), code=document.getElementById("code");
  var e1=document.getElementById("err1"), e2=document.getElementById("err2"), b1=document.getElementById("b1"), b2=document.getElementById("b2");
  function err(el,msg){el.textContent=msg||"";el.hidden=!msg}
  function request(){var v=email.value.trim(); if(v.indexOf("@")<0){err(e1,"Enter your work email.");return;} b1.disabled=true;b1.textContent="Sending…";err(e1,"");
    post("/request-code",{email:v}).then(function(j){ if(j.__status===429){err(e1,j.error||"Too many requests. Wait a few minutes and try again.");return;}
      document.getElementById("shown").textContent=v; fe.hidden=true; fc.hidden=false; code.value=""; b2.disabled=true; err(e2,""); setTimeout(function(){code.focus()},50);
    }).catch(function(){err(e1,"Could not reach the server. Check your connection and try again.")}).finally(function(){b1.disabled=false;b1.textContent="Send me a code"})}
  fe.onsubmit=function(ev){ev.preventDefault();request()};
  document.getElementById("change").onclick=function(){fc.hidden=true;fe.hidden=false;email.focus()};
  document.getElementById("resend").onclick=function(){request()};
  code.oninput=function(){code.value=code.value.replace(/\\D/g,"").slice(0,6); b2.disabled=code.value.length!==6; if(code.value.length===6){fc.requestSubmit?fc.requestSubmit():b2.click()}};
  fc.onsubmit=function(ev){ev.preventDefault(); if(code.value.length!==6)return; b2.disabled=true;b2.textContent="Checking…";err(e2,"");
    post("/verify",{email:email.value.trim(),code:code.value}).then(function(j){ if(j.ok){b2.textContent="Signed in";location.replace(location.pathname+location.search);return;}
      err(e2,j.error||"That code is not valid. Request a new one."); code.value=""; b2.disabled=true; b2.textContent="Sign in"; code.focus();
    }).catch(function(){err(e2,"Could not reach the server. Try again.");b2.disabled=false;b2.textContent="Sign in"})};
})();
</script></body></html>`;
}
