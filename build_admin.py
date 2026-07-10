import json, sys, os, hashlib
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\Acer\Documents\Opencode\labu\songs.json', 'r', encoding='utf-8') as f:
    songs_data = json.load(f)

minified = json.dumps(songs_data, ensure_ascii=False, separators=(',', ':'))

html = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Khristian Labu - Gospel Songbook</title>
<link rel="icon" type="image/png" href="logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&family=Noto+Sans+Myanmar:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg:#0f0f13;--bg2:#16161d;--bg3:#1e1e28;--card:#1a1a24;--card-hover:#22222e;
  --border:#2a2a3a;--text:#e8e8ed;--text2:#9898a8;--text3:#6a6a7a;
  --accent:#7c6aef;--accent2:#a78bfa;--accent-glow:rgba(124,106,239,0.15);
  --green:#34d399;--rose:#fb7185;--amber:#fbbf24;--blue:#60a5fa;
  --red:#ef4444;--radius:16px;--radius-sm:10px;--transition:0.25s cubic-bezier(0.4,0,0.2,1);
}
[data-theme="light"] {
  --bg:#f8f9fc;--bg2:#ffffff;--bg3:#eef0f5;--card:#ffffff;--card-hover:#f4f5fa;
  --border:#d8dce6;--text:#1a1a2e;--text2:#5a5a6e;--text3:#8a8a9e;
  --accent:#2563eb;--accent2:#3b82f6;--accent-glow:rgba(37,99,235,0.1);
  --green:#10b981;--rose:#f43f5e;--amber:#f59e0b;--blue:#3b82f6;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter','Noto Sans Myanmar',-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;transition:background var(--transition),color var(--transition);overflow-x:hidden;}
body::before{content:'';position:fixed;inset:0;background:linear-gradient(rgba(124,106,239,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(124,106,239,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0;}
[data-theme="light"] body::before{background:linear-gradient(rgba(37,99,235,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(37,99,235,0.04) 1px,transparent 1px);background-size:40px 40px;}
body::after{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 10% 0%,rgba(124,106,239,0.12) 0%,transparent 40%),radial-gradient(ellipse at 90% 100%,rgba(167,139,250,0.08) 0%,transparent 40%);pointer-events:none;z-index:0;}
[data-theme="light"] body::after{background:radial-gradient(ellipse at 10% 0%,rgba(37,99,235,0.06) 0%,transparent 40%),radial-gradient(ellipse at 90% 100%,rgba(59,130,246,0.04) 0%,transparent 40%);}
::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}
input,textarea,select,button{font-family:inherit;}

/* ─── NAV ─── */
nav{position:sticky;top:0;z-index:100;background:rgba(15,15,19,0.85);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid var(--border);padding:0 2rem;transition:background var(--transition);}
[data-theme="light"] nav{background:rgba(248,249,252,0.9);}
.nav-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px;}
.logo{display:flex;align-items:center;gap:10px;font-family:'Outfit',sans-serif;font-weight:800;font-size:1.3rem;cursor:pointer;user-select:none;letter-spacing:-0.02em;transition:all 0.3s ease;}
.logo:hover{transform:scale(1.02);}
.logo span{background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;transition:all 0.3s ease;}
.logo:hover span{filter:brightness(1.2);}
.logo img{width:40px;height:40px;border-radius:50%;object-fit:cover;transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);box-shadow:0 0 0 2px var(--accent),0 0 15px rgba(124,106,239,0.3);}
.logo:hover img{transform:scale(1.12) rotate(8deg);box-shadow:0 0 0 2px var(--accent2),0 0 25px rgba(124,106,239,0.5);}
.nav-actions{display:flex;align-items:center;gap:12px;}
.search-box{position:relative;width:280px;}
.search-box input{width:100%;padding:10px 14px 10px 38px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.875rem;outline:none;transition:all var(--transition);}
.search-box input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow);}
.search-box input::placeholder{color:var(--text3);}
.search-box svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--text3);}
.theme-toggle,.admin-btn{width:40px;height:40px;border-radius:10px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all var(--transition);font-size:1.1rem;}
.theme-toggle:hover,.admin-btn:hover{background:var(--card-hover);color:var(--text);}
.admin-btn.active{background:var(--accent-glow);color:var(--accent);border-color:var(--accent);}

/* ─── HERO ─── */
.hero{max-width:1200px;margin:0 auto;padding:4rem 2rem 2rem;text-align:center;}
.hero h1{font-family:'Outfit',sans-serif;font-size:clamp(2rem,5vw,3.5rem);font-weight:800;background:linear-gradient(135deg,var(--text),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:0.75rem;line-height:1.15;letter-spacing:-0.03em;}
[data-theme="light"] .hero h1{background:linear-gradient(135deg,#1e3a8a,#2563eb);-webkit-background-clip:text;background-clip:text;}
.hero p{color:var(--text2);font-size:1.1rem;max-width:500px;margin:0 auto 2rem;line-height:1.6;}
.stats{display:flex;justify-content:center;gap:2.5rem;flex-wrap:wrap;}
.stat{text-align:center;}.stat-num{font-size:2rem;font-weight:700;color:var(--accent);}
.stat-label{font-size:0.8rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;}

/* ─── CATEGORIES ─── */
.categories{max-width:1200px;margin:0 auto;padding:1rem 2rem 3rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;}
.cat-card{background:rgba(22,22,29,0.6);backdrop-filter:blur(20px) saturate(150%);-webkit-backdrop-filter:blur(20px) saturate(150%);border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius);padding:1.75rem;cursor:pointer;transition:all 0.4s cubic-bezier(0.25,0.46,0.45,0.94);position:relative;overflow:hidden;}
[data-theme="light"] .cat-card{background:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.5);box-shadow:0 4px 24px rgba(37,99,235,0.1),inset 0 1px 0 rgba(255,255,255,0.6);}
.cat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),transparent);opacity:0;transition:opacity 0.4s ease;}
.cat-card::after{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at center,rgba(124,106,239,0.06) 0%,transparent 50%);opacity:0;transition:opacity 0.5s ease;pointer-events:none;}
[data-theme="light"] .cat-card::after{background:radial-gradient(circle at center,rgba(37,99,235,0.08) 0%,transparent 50%);}
.cat-card:hover{transform:translateY(-6px) scale(1.01);border-color:rgba(124,106,239,0.4);box-shadow:0 20px 60px -10px rgba(124,106,239,0.25),0 0 0 1px rgba(124,106,239,0.1),inset 0 1px 0 rgba(255,255,255,0.1);}
[data-theme="light"] .cat-card:hover{box-shadow:0 20px 60px -10px rgba(37,99,235,0.2),0 0 0 1px rgba(37,99,235,0.15),inset 0 1px 0 rgba(255,255,255,0.8);border-color:rgba(37,99,235,0.3);background:rgba(255,255,255,0.85);}
.cat-card:hover::before{opacity:1;}
.cat-card:hover::after{opacity:1;}
.cat-icon{font-size:2.5rem;margin-bottom:1rem;filter:drop-shadow(0 4px 12px rgba(124,106,239,0.25));transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);}
[data-theme="light"] .cat-icon{filter:drop-shadow(0 4px 12px rgba(37,99,235,0.2));}
.cat-card:hover .cat-icon{transform:translateY(-4px) scale(1.1);filter:drop-shadow(0 8px 20px rgba(124,106,239,0.35));}
.cat-name{font-size:1.15rem;font-weight:700;margin-bottom:0.35rem;transition:color 0.3s ease;}
[data-theme="light"] .cat-name{color:#1e3a8a;}
.cat-card:hover .cat-name{color:var(--accent2);}
.cat-desc{font-size:0.85rem;color:var(--text2);margin-bottom:1.25rem;line-height:1.5;transition:color 0.3s ease;}
.cat-card:hover .cat-desc{color:var(--text);}
.cat-count{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;background:var(--accent-glow);color:var(--accent);font-size:0.8rem;font-weight:600;transition:all 0.3s ease;}
[data-theme="light"] .cat-count{background:rgba(37,99,235,0.12);color:#2563eb;}
.cat-card:hover .cat-count{background:var(--accent);color:white;box-shadow:0 4px 15px rgba(124,106,239,0.3);}

/* ─── SONG LIST ─── */
.view{display:none;}.view.active{display:block;}
.song-list-header{max-width:1200px;margin:0 auto;padding:2rem 2rem 1rem;}
.song-list-header h2{font-size:1.75rem;font-weight:700;margin-bottom:0.25rem;}
.song-list-header p{color:var(--text2);font-size:0.9rem;}
.song-grid{max-width:1200px;margin:0 auto;padding:0 2rem 3rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:0.75rem;}
.song-item{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem 1.25rem;cursor:pointer;transition:all var(--transition);display:flex;align-items:center;gap:1rem;}
.song-item:hover{border-color:var(--accent);background:var(--card-hover);transform:translateX(3px);}
.song-num{min-width:36px;height:36px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:600;color:var(--text3);flex-shrink:0;}
.song-info{flex:1;min-width:0;}.song-title{font-weight:500;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.song-meta{font-size:0.8rem;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.song-match{font-size:0.8rem;color:var(--accent2);margin-top:6px;padding:6px 10px;background:var(--accent-glow);border-radius:6px;border-left:2px solid var(--accent);line-height:1.5;white-space:pre-line;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;}

/* ─── SONG DETAIL ─── */
.song-detail{max-width:700px;margin:0 auto;padding:2rem;}
.song-detail-back{display:flex;align-items:center;gap:8px;margin-bottom:1.5rem;}
.song-detail-back button{padding:8px 16px;border-radius:var(--radius-sm);background:var(--bg3);border:1px solid var(--border);color:var(--text2);cursor:pointer;font-size:0.85rem;transition:all var(--transition);display:flex;align-items:center;gap:6px;}
.song-detail-back button:hover{background:var(--card-hover);color:var(--text);border-color:var(--accent);}
.song-detail-header{display:flex;align-items:center;justify-content:center;gap:1rem;margin-bottom:0;padding-bottom:1.5rem;border-bottom:1px solid var(--border);}
.song-nav-btn{width:44px;height:44px;border-radius:50%;background:var(--bg3);border:1px solid var(--border);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all var(--transition);flex-shrink:0;}
.song-nav-btn:hover:not(:disabled){background:var(--accent);color:white;border-color:var(--accent);transform:scale(1.1);}
.song-nav-btn:disabled{opacity:0.2;cursor:not-allowed;}
.song-nav-btn svg{width:20px;height:20px;}
.song-header-center{text-align:center;flex:1;min-width:0;}
.song-header-center .song-number{display:inline-block;padding:4px 12px;border-radius:8px;background:var(--accent-glow);color:var(--accent);font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;}
.song-header-center h1{font-size:1.75rem;font-weight:700;margin-bottom:0.5rem;line-height:1.3;}
.song-breadcrumb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:1.5rem;font-size:0.85rem;}
.song-breadcrumb a{color:var(--accent);text-decoration:none;cursor:pointer;transition:color var(--transition);font-weight:500;}
.song-breadcrumb a:hover{color:var(--accent2);text-decoration:underline;}
.song-breadcrumb .sep{color:var(--text3);font-size:0.75rem;}
.song-breadcrumb .current{color:var(--text2);font-weight:400;}
.song-header-center .song-detail-meta{display:flex;justify-content:center;gap:1.5rem;flex-wrap:wrap;color:var(--text2);font-size:0.85rem;}
.song-header-center .song-detail-meta span{display:flex;align-items:center;gap:4px;}
.verse{margin-bottom:2rem;}.verse-type{display:inline-block;padding:3px 10px;border-radius:6px;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.75rem;}
.verse-type.v{background:var(--accent-glow);color:var(--accent);}.verse-type.c{background:rgba(52,211,153,0.12);color:var(--green);}
.verse-type.b{background:rgba(251,191,36,0.12);color:var(--amber);}.verse-type.p{background:rgba(251,113,133,0.12);color:var(--rose);}
.verse p{font-size:1.05rem;line-height:1.85;color:var(--text);margin:0;white-space:pre-line;}
.no-results{text-align:center;padding:4rem 2rem;color:var(--text3);}.no-results .icon{font-size:3rem;margin-bottom:1rem;}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
.fade-in{animation:fadeIn 0.35s ease-out forwards;}
@keyframes slideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
.hero{position:relative;z-index:1;}
.hero h1{animation:fadeIn 0.5s ease-out;}
.song-detail-header{animation:fadeIn 0.4s ease-out;}
.verse{transition:all var(--transition);padding:0.5rem;border-radius:var(--radius-sm);}
.verse:hover{transform:translateX(4px);background:var(--bg3);}
.song-breadcrumb a{position:relative;overflow:hidden;}
.song-breadcrumb a::after{content:'';position:absolute;bottom:-1px;left:0;width:0;height:1px;background:var(--accent);transition:width 0.3s ease;}
.song-breadcrumb a:hover::after{width:100%;}
.nav-inner .logo{animation:fadeIn 0.6s ease-out;}

/* ─── MODAL ─── */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:200;align-items:center;justify-content:center;padding:1rem;}
.modal-overlay.open{display:flex;}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;animation:slideUp 0.3s ease-out;}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);}
.modal-header h3{font-size:1.1rem;font-weight:600;}
.modal-close{width:32px;height:32px;border-radius:8px;background:var(--bg3);border:none;color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.2rem;transition:all var(--transition);}
.modal-close:hover{background:var(--red);color:white;}
.modal-body{padding:1.5rem;}
.modal-footer{padding:1rem 1.5rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:0.75rem;}

/* ─── FORMS ─── */
.form-group{margin-bottom:1.25rem;}
.form-group label{display:block;font-size:0.8rem;font-weight:500;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.03em;}
.form-group input,.form-group textarea,.form-group select{width:100%;padding:10px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.9rem;outline:none;transition:all var(--transition);}
.form-group input:focus,.form-group textarea:focus,.form-group select:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow);}
.form-group textarea{resize:vertical;min-height:80px;line-height:1.6;}
.form-group select{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236a6a7a' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem;}
.btn{padding:10px 20px;border-radius:var(--radius-sm);border:1px solid var(--border);cursor:pointer;font-size:0.875rem;font-weight:500;transition:all var(--transition);}
.btn-primary{background:var(--accent);color:white;border-color:var(--accent);}.btn-primary:hover{background:var(--accent2);}
.btn-danger{background:var(--red);color:white;border-color:var(--red);}.btn-danger:hover{opacity:0.85;}
.btn-ghost{background:transparent;color:var(--text2);}.btn-ghost:hover{background:var(--bg3);color:var(--text);}

/* ─── ADMIN PANEL ─── */
.admin-panel{max-width:1200px;margin:0 auto;padding:2rem;}
.admin-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;flex-wrap:wrap;gap:1rem;}
.admin-header h2{font-size:1.5rem;font-weight:700;}
.admin-tabs{display:flex;gap:4px;background:var(--bg3);border-radius:var(--radius-sm);padding:4px;flex-wrap:wrap;}
.admin-tab{padding:8px 16px;border-radius:8px;border:none;background:transparent;color:var(--text2);cursor:pointer;font-size:0.8rem;font-weight:500;transition:all var(--transition);}
.admin-tab.active{background:var(--accent);color:white;}
.admin-tab:hover:not(.active){background:var(--card-hover);color:var(--text);}
.admin-toolbar{display:flex;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;align-items:center;}
.admin-search{flex:1;min-width:200px;padding:10px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:0.875rem;outline:none;transition:all var(--transition);}
.admin-search:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow);}
.admin-song-list{display:flex;flex-direction:column;gap:0.5rem;}
.admin-song-row{display:flex;align-items:center;gap:1rem;padding:0.85rem 1rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);transition:all var(--transition);}
.admin-song-row:hover{border-color:var(--accent);background:var(--card-hover);}
.admin-song-row .song-num{min-width:32px;height:32px;font-size:0.75rem;}
.admin-song-row .song-info{flex:1;}
.admin-song-row .song-title{font-size:0.9rem;}
.admin-song-row .song-meta{font-size:0.75rem;}
.admin-actions{display:flex;gap:6px;}
.admin-actions button{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.85rem;transition:all var(--transition);}
.admin-actions button:hover{border-color:var(--accent);color:var(--accent);}
.admin-actions button.del:hover{border-color:var(--red);color:var(--red);}

/* ─── FIND & REPLACE ─── */
.find-replace{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;margin-bottom:1.5rem;display:none;}
.find-replace.show{display:block;}
.find-replace h3{font-size:1.1rem;font-weight:600;margin-bottom:1rem;display:flex;align-items:center;gap:8px;}
.find-replace-row{display:flex;gap:0.75rem;flex-wrap:wrap;align-items:end;margin-bottom:1rem;}
.find-replace-row .form-group{flex:1;min-width:200px;margin-bottom:0;}
.find-replace-options{display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;font-size:0.85rem;color:var(--text2);}
.find-replace-options label{display:flex;align-items:center;gap:6px;cursor:pointer;}
.find-replace-options input[type="checkbox"]{accent-color:var(--accent);width:16px;height:16px;}
.find-replace-results{background:var(--bg3);border-radius:var(--radius-sm);padding:1rem;max-height:200px;overflow-y:auto;font-size:0.85rem;color:var(--text2);margin-bottom:1rem;display:none;}
.find-replace-results.show{display:block;}
.find-replace-results .match{padding:0.5rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;}
.find-replace-results .match:last-child{border-bottom:none;}
.find-replace-results .match-song{font-weight:500;color:var(--text);}
.find-replace-results .match-text{color:var(--text3);font-size:0.8rem;}
.find-replace-results .highlight{background:rgba(251,191,36,0.3);color:var(--amber);padding:0 2px;border-radius:2px;}
.find-replace-stats{font-size:0.85rem;color:var(--text2);margin-bottom:1rem;}
.find-replace-actions{display:flex;gap:0.75rem;flex-wrap:wrap;}

/* ─── LOGIN ─── */
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 64px);padding:2rem;}
.login-box{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:2.5rem;width:100%;max-width:400px;animation:slideUp 0.3s ease-out;}
.login-box h2{text-align:center;margin-bottom:0.5rem;font-size:1.3rem;}
.login-box p{text-align:center;color:var(--text2);font-size:0.85rem;margin-bottom:1.5rem;}
.login-box .form-group{margin-bottom:1.25rem;}
.login-box .btn{width:100%;padding:12px;font-size:0.95rem;}
.login-error{text-align:center;color:var(--rose);font-size:0.85rem;margin-bottom:1rem;display:none;}
.login-hint{text-align:center;color:var(--text3);font-size:0.75rem;margin-top:1rem;}
.logged-in-bar{display:none;align-items:center;gap:8px;padding:6px 12px;border-radius:var(--radius-sm);background:var(--accent-glow);color:var(--accent);font-size:0.8rem;font-weight:500;}
.logged-in-bar.show{display:flex;}
.logged-in-bar button{background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.8rem;text-decoration:underline;}

/* ─── TOAST ─── */
.toast-container{position:fixed;bottom:2rem;right:2rem;z-index:300;display:flex;flex-direction:column;gap:0.5rem;}
.toast{padding:12px 20px;border-radius:var(--radius-sm);background:var(--card);border:1px solid var(--border);color:var(--text);font-size:0.85rem;animation:slideUp 0.3s ease-out;box-shadow:0 8px 24px rgba(0,0,0,0.3);}
.toast.success{border-color:var(--green);}.toast.error{border-color:var(--red);}

/* ─── CONFIRM DIALOG ─── */
.confirm-body{text-align:center;padding:1rem 0;}
.confirm-body .icon{font-size:2.5rem;margin-bottom:0.75rem;}
.confirm-body p{color:var(--text2);line-height:1.5;}

@media(max-width:768px){
  nav{padding:0 1rem;}
  .nav-inner{height:56px;}
  .logo span{font-size:1rem;}
  .logo img{width:32px;height:32px;}
  .search-box{width:140px;}
  .search-box input{padding:8px 12px 8px 34px;font-size:0.8rem;}
  .theme-toggle,.admin-btn{width:36px;height:36px;}
  .hero{padding:2rem 1rem 1rem;}
  .hero h1{font-size:1.8rem;}
  .hero p{font-size:0.95rem;}
  .stats{gap:1.5rem;}
  .stat-num{font-size:1.5rem;}
  .categories{padding:1rem;gap:0.75rem;grid-template-columns:1fr;}
  .cat-card{padding:1.25rem;}
  .cat-icon{font-size:1.5rem;}
  .song-list-header{padding:1.5rem 1rem 0.5rem;}
  .song-list-header h2{font-size:1.3rem;}
  .song-grid{grid-template-columns:1fr;padding:0 1rem 2rem;gap:0.5rem;}
  .song-item{padding:0.85rem 1rem;}
  .song-num{min-width:32px;height:32px;font-size:0.75rem;}
  .song-detail{padding:1.25rem 1rem;}
  .song-detail-header{gap:0.5rem;}
  .song-nav-btn{width:38px;height:38px;}
  .song-nav-btn svg{width:18px;height:18px;}
  .song-header-center h1{font-size:1.4rem;}
  .song-header-center .song-detail-meta{gap:1rem;font-size:0.8rem;}
  .song-breadcrumb{font-size:0.8rem;gap:6px;}
  .song-detail-back button{padding:6px 12px;font-size:0.8rem;}
  .verse p{font-size:0.95rem;line-height:1.7;}
  .prev-next{flex-direction:column;gap:0.75rem;}
  .prev-next button{padding:10px 12px;}
  .prev-next button .label{font-size:0.7rem;}
  .prev-next button .title{font-size:0.85rem;}
  .admin-panel{padding:1rem;}
  .admin-header{flex-direction:column;align-items:stretch;}
  .admin-header h2{font-size:1.2rem;}
  .admin-tabs{flex-wrap:wrap;}
  .admin-tab{padding:6px 12px;font-size:0.75rem;}
  .admin-toolbar{flex-direction:column;}
  .admin-search{min-width:auto;}
  .admin-song-row{padding:0.75rem;gap:0.75rem;}
  .admin-actions button{width:28px;height:28px;font-size:0.8rem;}
  .modal{margin:0.5rem;max-height:95vh;}
  .modal-body{padding:1rem;}
  .form-row{grid-template-columns:1fr;}
  .login-box{padding:1.5rem;}
  .toast-container{bottom:1rem;right:1rem;left:1rem;}
  .toast{font-size:0.8rem;padding:10px 16px;}
}
@media(max-width:380px){
  .logo span{display:none;}
  .search-box{width:120px;}
  .hero h1{font-size:1.5rem;}
  .stats{gap:1rem;}
  .stat-num{font-size:1.3rem;}
  .stat-label{font-size:0.7rem;}
}
</style>
</head>
<body>
<nav>
  <div class="nav-inner">
    <div class="logo" onclick="goHome()"><img src="logo.png" alt="Logo"><span>Khristian Labu</span></div>
    <div class="nav-actions">
      <div class="logged-in-bar" id="loggedInBar">
        <span id="loggedInUser"></span>
        <button onclick="adminLogout()">Logout</button>
      </div>
      <button class="back-btn" id="backBtn" onclick="goHome()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Home
      </button>
      <div class="search-box" id="searchBox">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" id="searchInput" placeholder="Search songs..." oninput="onSearch(this.value)">
      </div>
      <button class="admin-btn" id="adminBtn" onclick="openAdmin()" title="Admin Panel">⚙️</button>
      <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">☀️</button>
    </div>
  </div>
</nav>

<!-- HOME -->
<div class="view active" id="homeView">
  <div class="hero fade-in">
    <h1>Khristian Labu</h1>
    <p>1,407 hymns and songs of faith from the Pa-O Evangelical Baptist Convention</p>
    <div class="stats">
      <div class="stat"><div class="stat-num">1,407</div><div class="stat-label">Songs</div></div>
      <div class="stat"><div class="stat-num">4</div><div class="stat-label">Songbooks</div></div>
      <div class="stat"><div class="stat-num">∞</div><div class="stat-label">Blessings</div></div>
    </div>
  </div>
  <div class="categories" id="categoryGrid"></div>
</div>

<!-- SONG LIST -->
<div class="view" id="listView">
  <div class="song-list-header" id="listHeader"></div>
  <div class="song-grid" id="songGrid"></div>
</div>

<!-- SONG DETAIL -->
<div class="view" id="detailView"><div class="song-detail" id="songDetail"></div></div>

<!-- SEARCH -->
<div class="view" id="searchView"><div class="search-results" id="searchResults"></div></div>

<!-- ADMIN PANEL -->
<div class="view" id="adminView">
  <div class="admin-panel">
    <div class="admin-header">
      <h2>⚙️ Admin Panel</h2>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        <button class="btn btn-ghost" onclick="openModal('passwordModal')">🔑 Change Password</button>
        <button class="btn btn-ghost" onclick="toggleFindReplace()">🔍 Find & Replace</button>
        <button class="btn btn-ghost" onclick="openExportModal()">📤 Export</button>
        <button class="btn btn-primary" onclick="openAddModal()">+ Add Song</button>
      </div>
    </div>
    <div class="admin-tabs" id="adminTabs"></div>
    <div class="find-replace" id="findReplace">
      <h3>🔍 Find & Replace</h3>
      <div class="find-replace-row">
        <div class="form-group">
          <label>Find</label>
          <input type="text" id="findInput" placeholder="Text to find..." oninput="previewFindReplace()">
        </div>
        <div class="form-group">
          <label>Replace</label>
          <input type="text" id="replaceInput" placeholder="Replace with...">
        </div>
      </div>
      <div class="find-replace-options">
        <label><input type="checkbox" id="frTitles" checked onchange="previewFindReplace()"> Titles</label>
        <label><input type="checkbox" id="frVerses" checked onchange="previewFindReplace()"> Verses</label>
        <label><input type="checkbox" id="frAuthors" onchange="previewFindReplace()"> Authors</label>
        <label><input type="checkbox" id="frCaseSensitive"> Case Sensitive</label>
      </div>
      <div class="find-replace-stats" id="frStats"></div>
      <div class="find-replace-results" id="frResults"></div>
      <div class="find-replace-actions">
        <button class="btn btn-primary" onclick="executeReplace()">Replace All</button>
        <button class="btn btn-ghost" onclick="clearFindReplace()">Clear</button>
      </div>
    </div>
    <div class="admin-toolbar">
      <input class="admin-search" id="adminSearch" placeholder="Filter songs..." oninput="filterAdminSongs(this.value)">
      <span style="color:var(--text3);font-size:0.8rem;" id="adminCount"></span>
    </div>
    <div class="admin-song-list" id="adminSongList"></div>
  </div>
</div>

<!-- LOGIN VIEW -->
<div class="view" id="loginView">
  <div class="login-wrap">
    <div class="login-box fade-in">
      <h2>🔐 Admin Login</h2>
      <p>Enter credentials to manage songs</p>
      <div class="login-error" id="loginError">Invalid password</div>
      <div class="form-group">
        <label>Username</label>
        <input type="text" id="loginUser" value="admin" autocomplete="username">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="loginPass" placeholder="Enter password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <button class="btn btn-primary" onclick="doLogin()">Sign In</button>
      <div class="login-hint">Default: admin / admin123</div>
    </div>
  </div>
</div>



<!-- MODALS -->
<div class="modal-overlay" id="songModal">
  <div class="modal">
    <div class="modal-header">
      <h3 id="modalTitle">Add Song</h3>
      <button class="modal-close" onclick="closeModal('songModal')">&times;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="editSongId">
      <div class="form-group">
        <label>Category</label>
        <select id="formCat">
          <option value="B&P">Biakna Leh Phatna</option>
          <option value="BL">Biakna Late</option>
          <option value="PN">Pathian Ngaih La</option>
          <option value="SM">Suangmantamte</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Song Number</label>
          <input type="text" id="formNum" placeholder="e.g. 143">
        </div>
        <div class="form-group">
          <label>Key</label>
          <input type="text" id="formKey" placeholder="e.g. Doh is G">
        </div>
      </div>
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="formTitle" placeholder="Song title">
      </div>
      <div class="form-group">
        <label>Author</label>
        <input type="text" id="formAuthor" placeholder="Author name">
      </div>
      <div class="form-group">
        <label>Verses (one per block, separated by blank line. Prefix with C: for chorus, B: for bridge)</label>
        <textarea id="formVerses" rows="12" placeholder="V: First verse line 1
First verse line 2
First verse line 3

C: Chorus line 1
Chorus line 2

V: Second verse line 1
Second verse line 2"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('songModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveSong()">Save Song</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="confirmModal">
  <div class="modal" style="max-width:400px;">
    <div class="modal-header">
      <h3 id="confirmTitle">Confirm</h3>
      <button class="modal-close" onclick="closeModal('confirmModal')">&times;</button>
    </div>
    <div class="modal-body">
      <div class="confirm-body">
        <div class="icon" id="confirmIcon">⚠️</div>
        <p id="confirmMsg"></p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('confirmModal')">Cancel</button>
      <button class="btn btn-danger" id="confirmBtn" onclick="">Delete</button>
    </div>
  </div>
</div>

<!-- CHANGE PASSWORD MODAL -->
<div class="modal-overlay" id="passwordModal">
  <div class="modal">
    <div class="modal-header">
      <h3>🔑 Change Password</h3>
      <button class="modal-close" onclick="closeModal('passwordModal')">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Current Password</label>
        <input type="password" id="oldPass" placeholder="Enter current password">
      </div>
      <div class="form-group">
        <label>New Password</label>
        <input type="password" id="newPass" placeholder="Enter new password">
      </div>
      <div class="form-group">
        <label>Confirm New Password</label>
        <input type="password" id="confirmPass" placeholder="Confirm new password">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('passwordModal')">Cancel</button>
      <button class="btn btn-primary" onclick="changePassword()">Update Password</button>
    </div>
  </div>
</div>

<!-- EXPORT MODAL -->
<div class="modal-overlay" id="exportModal">
  <div class="modal">
    <div class="modal-header">
      <h3>📤 Export Songs</h3>
      <button class="modal-close" onclick="closeModal('exportModal')">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Export Scope</label>
        <select id="exportScope">
          <option value="all">All Songs (1,407)</option>
          <option value="cat">Current Category</option>
          <option value="single">Single Song</option>
        </select>
      </div>
      <div class="form-group">
        <label>Format</label>
        <select id="exportFormat">
          <option value="json">JSON</option>
          <option value="txt">Plain Text</option>
        </select>
      </div>
      <div id="exportSingleInfo" style="display:none;">
        <div style="background:var(--bg3);padding:0.75rem 1rem;border-radius:var(--radius-sm);color:var(--text2);font-size:0.85rem;">
          Exporting: <strong id="exportSongTitle" style="color:var(--text);"></strong>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('exportModal')">Cancel</button>
      <button class="btn btn-primary" onclick="executeExport()">Download</button>
    </div>
  </div>
</div>

<div class="toast-container" id="toastContainer"></div>

<script>
// ─── DATA ───
const DATA_VERSION = 2;
const DEFAULT_SONGS = ''' + minified + r''';
let SONGS = {};
let isAdmin = false;
let adminCat = 'B&P';
let adminFilter = '';

// ─── INIT ───
function init() {
  loadSongs();
  renderCategories();
  if (localStorage.getItem('labu-theme') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.querySelector('.theme-toggle').textContent = '\u{1F319}';
  }
  if (localStorage.getItem('labu_admin_session') === '1') {
    isAdmin = true;
    updateAdminUI();
  }
}

function loadSongs() {
  const savedVersion = parseInt(localStorage.getItem('labu_data_version') || '0');
  const saved = localStorage.getItem('labu_songs');
  if (saved && savedVersion >= DATA_VERSION) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed['B&P'] && parsed['B&P'].songs && parsed['B&P'].songs.length > 0) {
        SONGS = parsed;
        return;
      }
    } catch(e) {}
  }
  SONGS = JSON.parse(JSON.stringify(DEFAULT_SONGS));
  localStorage.setItem('labu_data_version', DATA_VERSION);
  saveSongs();
}

function saveSongs() {
  localStorage.setItem('labu_songs', JSON.stringify(SONGS));
}

// ─── NAVIGATION ───
let currentView = 'home', currentCat = null, currentList = [], currentSongIdx = -1;

function showView(v) {
  currentView = v;
  ['homeView','listView','detailView','searchView','adminView','loginView'].forEach(id => {
    document.getElementById(id).classList.toggle('active', id === v + 'View');
  });
  document.getElementById('backBtn').classList.toggle('show', !['home','admin','login'].includes(v));
  document.getElementById('searchBox').style.display = v === 'admin' || v === 'login' ? 'none' : '';
  document.getElementById('adminBtn').classList.toggle('active', v === 'admin');
}

function goHome() { showView('home'); currentCat = null; currentList = []; document.getElementById('searchInput').value = ''; }

// ─── CATEGORIES ───
const CAT_ORDER = ['B&P','BL','PN','SM'];
function renderCategories() {
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = '';
  CAT_ORDER.forEach((key, i) => {
    const cat = SONGS[key];
    const card = document.createElement('div');
    card.className = 'cat-card fade-in';
    card.style.animationDelay = (i * 0.08) + 's';
    card.onclick = () => openCategory(key);
    card.innerHTML = '<div class="cat-icon">'+cat.info.icon+'</div><div class="cat-name">'+cat.info.name+'</div><div class="cat-desc">'+cat.info.description+'</div><div class="cat-count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> '+cat.songs.length+' songs</div>';
    grid.appendChild(card);
  });
}

function openCategory(key) {
  currentCat = key; currentList = SONGS[key].songs;
  showView('list');
  document.getElementById('listHeader').innerHTML = '<h2>'+SONGS[key].info.icon+' '+SONGS[key].info.name+'</h2><p>'+SONGS[key].info.description+' · '+currentList.length+' songs</p>';
  renderSongList(currentList);
  document.getElementById('searchInput').value = '';
}

function renderSongList(songs) {
  const grid = document.getElementById('songGrid');
  grid.innerHTML = '';
  if (!songs.length) { grid.innerHTML = '<div class="no-results"><div class="icon">🔍</div><p>No songs found</p></div>'; return; }
  const bookName = currentCat ? SONGS[currentCat].info.name : '';
  songs.forEach((song, i) => {
    const item = document.createElement('div');
    item.className = 'song-item fade-in';
    item.style.animationDelay = Math.min(i * 0.02, 0.5) + 's';
    item.onclick = () => openSong(song);
    const meta = [bookName, song.author, song.key ? 'Key: ' + song.key : ''].filter(Boolean).join(' · ');
    item.innerHTML = '<div class="song-num">'+(song.number||(i+1))+'</div><div class="song-info"><div class="song-title">'+esc(song.title)+'</div><div class="song-meta">'+esc(meta)+'</div></div>';
    grid.appendChild(item);
  });
}

function openSong(song) {
  currentSongIdx = currentList.findIndex(s => s.id === song.id);
  showView('detail');
  renderSongDetail(song);
}

function renderSongDetail(song) {
  const el = document.getElementById('songDetail');
  const vt = {v:'Verse',c:'Chorus',b:'Bridge',p:'Pre-Chorus'};
  const vc = {v:0,c:0,b:0,p:0};
  let vh = '';
  (song.verses||[]).forEach(v => {
    const cls = v.type||'v';
    vc[cls] = (vc[cls]||0) + 1;
    const label = vt[cls]||'Verse';
    const count = vc[cls];
    const total = (song.verses||[]).filter(x => (x.type||'v') === cls).length;
    const numStr = total > 1 ? ' ' + count : '';
    vh += '<div class="verse fade-in"><div class="verse-type '+cls+'">'+label+numStr+'</div><p>'+esc(v.lines.join('\n'))+'</p></div>';
  });
  const meta = [];
  if (song.author) meta.push('<span>✍️ '+esc(song.author)+'</span>');
  if (song.key) meta.push('<span>🎹 '+esc(song.key)+'</span>');
  const catName = currentCat ? SONGS[currentCat].info.name : 'Home';
  const breadcrumb = '<div class="song-breadcrumb fade-in"><a onclick="goHome()">🏠 Home</a><span class="sep">›</span><a onclick="openCategory(\''+currentCat+'\')">'+esc(catName)+'</a><span class="sep">›</span><span class="current">'+esc(song.title)+'</span></div>';
  const numBadge = song.number ? '<div class="song-number">No. '+esc(song.number)+'</div>' : '';
  const prev = currentList[currentSongIdx-1], next = currentList[currentSongIdx+1];
  const prevSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';
  const nextSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
  const header = '<div class="song-detail-header fade-in"><button class="song-nav-btn" '+(prev?'onclick="openSong(currentList[currentSongIdx-1])"':'disabled')+'>'+prevSvg+'</button><div class="song-header-center">'+numBadge+'<h1>'+esc(song.title)+'</h1><div class="song-detail-meta">'+meta.join('')+'</div></div><button class="song-nav-btn" '+(next?'onclick="openSong(currentList[currentSongIdx+1])"':'disabled')+'>'+nextSvg+'</button></div>';
  el.innerHTML = breadcrumb+'<div class="song-detail-back fade-in"><button onclick="openCategory(\''+currentCat+'\')">← Back to '+esc(catName)+'</button></div>'+header+vh;
  window.scrollTo({top:0,behavior:'smooth'});
}

// ─── SEARCH ───
let searchTimeout;
function onSearch(q) { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => doSearch(q), 200); }
function doSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) { goHome(); return; }
  showView('search');
  const results = [];
  CAT_ORDER.forEach(key => {
    SONGS[key].songs.forEach(song => {
      const hay = (song.title+' '+song.author+' '+song.key+' '+song.number).toLowerCase();
      if (hay.includes(q)) { results.push({...song, cat: key, catName: SONGS[key].info.name, matchField: 'title'}); return; }
      if (song.verses) {
        for (let vi = 0; vi < song.verses.length; vi++) {
          for (let li = 0; li < song.verses[vi].lines.length; li++) {
            if (song.verses[vi].lines[li].toLowerCase().includes(q)) {
              const vt = {v:'Verse',c:'Chorus',b:'Bridge',p:'Pre-Chorus'};
              const vtype = vt[song.verses[vi].type||'v'] || 'Verse';
              const allLines = song.verses[vi].lines;
              const start = Math.max(0, li - 1);
              const end = Math.min(allLines.length, li + 3);
              const context = allLines.slice(start, end).join('\n');
              results.push({...song, cat: key, catName: SONGS[key].info.name, matchField: 'verse', snippet: vtype + ':\n' + context});
              return;
            }
          }
        }
      }
    });
  });
  const el = document.getElementById('searchResults');
  el.innerHTML = '<div class="song-list-header"><h2>Search Results</h2><p>'+results.length+' result'+(results.length!==1?'s':'')+' for "'+esc(q)+'"</p></div>';
  if (!results.length) { el.innerHTML += '<div class="no-results"><div class="icon">🔍</div><p>No songs match your search</p></div>'; return; }
  const grid = document.createElement('div');
  grid.className = 'song-grid';
  results.forEach((song, i) => {
    const item = document.createElement('div');
    item.className = 'song-item fade-in';
    item.style.animationDelay = Math.min(i*0.02,0.5)+'s';
    item.onclick = () => { currentCat = song.cat; currentList = SONGS[song.cat].songs; openSong(song); };
    const meta = [song.author, song.catName, song.key?'Key: '+song.key:''].filter(Boolean).join(' · ');
    const snippet = song.snippet ? '<div class="song-match">'+esc(song.snippet)+'</div>' : '';
    item.innerHTML = '<div class="song-num">'+(song.number||'')+'</div><div class="song-info"><div class="song-title">'+esc(song.title)+'</div><div class="song-meta">'+esc(meta)+'</div>'+snippet+'</div>';
    grid.appendChild(item);
  });
  el.appendChild(grid);
}

// ─── THEME ───
function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', isLight ? '' : 'light');
  document.querySelector('.theme-toggle').textContent = isLight ? '\u2600\uFE0F' : '\u{1F319}';
  localStorage.setItem('labu-theme', isLight ? 'dark' : 'light');
}

// ─── ADMIN LOGIN ───
async function hashPassword(pw) {
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getAdminCreds() {
  const stored = localStorage.getItem('labu_admin_creds');
  if (stored) return JSON.parse(stored);
  // default: admin / admin123
  return { user: 'admin', passHash: '' }; // will be set on first login
}

async function ensureDefaultCreds() {
  const creds = getAdminCreds();
  if (!creds.passHash) {
    const hash = await hashPassword('admin123');
    localStorage.setItem('labu_admin_creds', JSON.stringify({ user: 'admin', passHash: hash }));
  }
}

function openAdmin() {
  if (isAdmin) { showView('admin'); renderAdminPanel(); return; }
  showView('login');
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').style.display = 'none';
}

async function doLogin() {
  await ensureDefaultCreds();
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const creds = getAdminCreds();
  const hash = await hashPassword(pass);
  if (user === creds.user && hash === creds.passHash) {
    isAdmin = true;
    localStorage.setItem('labu_admin_session', '1');
    updateAdminUI();
    showView('admin');
    renderAdminPanel();
    toast('Logged in successfully', 'success');
  } else {
    document.getElementById('loginError').style.display = 'block';
  }
}

async function changePassword() {
  const oldPass = document.getElementById('oldPass').value;
  const newPass = document.getElementById('newPass').value;
  const confirmPass = document.getElementById('confirmPass').value;
  if (!oldPass || !newPass || !confirmPass) { toast('All fields are required', 'error'); return; }
  if (newPass.length < 4) { toast('Password must be at least 4 characters', 'error'); return; }
  if (newPass !== confirmPass) { toast('New passwords do not match', 'error'); return; }
  await ensureDefaultCreds();
  const creds = getAdminCreds();
  const oldHash = await hashPassword(oldPass);
  if (oldHash !== creds.passHash) { toast('Current password is incorrect', 'error'); return; }
  const newHash = await hashPassword(newPass);
  creds.passHash = newHash;
  localStorage.setItem('labu_admin_creds', JSON.stringify(creds));
  document.getElementById('oldPass').value = '';
  document.getElementById('newPass').value = '';
  document.getElementById('confirmPass').value = '';
  closeModal('passwordModal');
  toast('Password changed successfully', 'success');
}

function adminLogout() {
  isAdmin = false;
  localStorage.removeItem('labu_admin_session');
  updateAdminUI();
  goHome();
  toast('Logged out', 'success');
}

function updateAdminUI() {
  const bar = document.getElementById('loggedInBar');
  bar.classList.toggle('show', isAdmin);
  document.getElementById('loggedInUser').textContent = isAdmin ? '👤 admin' : '';
}

// ─── ADMIN PANEL ───
function renderAdminPanel() {
  // tabs
  const tabs = document.getElementById('adminTabs');
  tabs.innerHTML = '';
  CAT_ORDER.forEach(key => {
    const tab = document.createElement('button');
    tab.className = 'admin-tab' + (key === adminCat ? ' active' : '');
    tab.textContent = SONGS[key].info.name + ' (' + SONGS[key].songs.length + ')';
    tab.onclick = () => { adminCat = key; renderAdminPanel(); };
    tabs.appendChild(tab);
  });
  renderAdminSongs();
}

function renderAdminSongs() {
  const list = document.getElementById('adminSongList');
  let songs = SONGS[adminCat].songs;
  if (adminFilter) {
    const q = adminFilter.toLowerCase();
    songs = songs.filter(s => (s.title+' '+s.author+' '+s.number+' '+s.key).toLowerCase().includes(q));
  }
  document.getElementById('adminCount').textContent = songs.length + ' songs';
  list.innerHTML = '';
  if (!songs.length) { list.innerHTML = '<div class="no-results"><div class="icon">📭</div><p>No songs found</p></div>'; return; }
  songs.forEach((song, i) => {
    const row = document.createElement('div');
    row.className = 'admin-song-row fade-in';
    row.style.animationDelay = Math.min(i*0.015, 0.4)+'s';
    const meta = [song.author, song.key?'Key: '+song.key:''].filter(Boolean).join(' · ');
    row.innerHTML = '<div class="song-num">'+(song.number||'')+'</div><div class="song-info"><div class="song-title">'+esc(song.title)+'</div><div class="song-meta">'+esc(meta)+'</div></div><div class="admin-actions"><button onclick="openExportModal(\''+song.id+'\')" title="Export">📤</button><button onclick="openEditModal(\''+song.id+'\')" title="Edit">✏️</button><button class="del" onclick="confirmDelete(\''+song.id+'\')" title="Delete">🗑️</button></div>';
    list.appendChild(row);
  });
}

function filterAdminSongs(q) { adminFilter = q; renderAdminSongs(); }

// ─── EXPORT ───
let exportSongId = null;

function openExportModal(songId) {
  exportSongId = songId || null;
  if (songId) {
    document.getElementById('exportScope').value = 'single';
    document.getElementById('exportScope').disabled = true;
    let song = null;
    CAT_ORDER.forEach(k => { const f = SONGS[k].songs.find(s => s.id === songId); if (f) song = f; });
    if (song) document.getElementById('exportSongTitle').textContent = song.title;
    document.getElementById('exportSingleInfo').style.display = 'block';
  } else {
    document.getElementById('exportScope').disabled = false;
    document.getElementById('exportSingleInfo').style.display = 'none';
  }
  openModal('exportModal');
}

document.getElementById('exportScope').addEventListener('change', function() {
  document.getElementById('exportSingleInfo').style.display = this.value === 'single' ? 'block' : 'none';
});

function executeExport() {
  const scope = document.getElementById('exportScope').value;
  const format = document.getElementById('exportFormat').value;
  let data, filename;
  if (scope === 'all') {
    data = SONGS;
    filename = 'khristian-labu-all';
  } else if (scope === 'cat') {
    data = { [adminCat]: SONGS[adminCat] };
    filename = 'khristian-labu-' + adminCat;
  } else {
    let song = null, songCat = null;
    CAT_ORDER.forEach(k => { const f = SONGS[k].songs.find(s => s.id === exportSongId); if (f) { song = f; songCat = k; } });
    if (!song) { toast('Song not found', 'error'); return; }
    data = song;
    filename = 'song-' + (song.number || song.id);
  }
  if (format === 'json') {
    downloadFile(JSON.stringify(data, null, 2), filename + '.json', 'application/json');
  } else {
    downloadFile(exportAsText(data), filename + '.txt', 'text/plain');
  }
  closeModal('exportModal');
  toast('Exported successfully', 'success');
}

function exportAsText(data) {
  const vt = {v:'Verse',c:'Chorus',b:'Bridge',p:'Pre-Chorus'};
  let txt = '';
  const songs = data.songs ? data.songs : (data[CAT_ORDER[0]] ? [] : [data]);
  if (data.songs) {
    txt += data.info ? data.info.name + '\n' + '='.repeat(40) + '\n\n' : '';
    data.songs.forEach(song => { txt += formatSongText(song, vt) + '\n\n'; });
  } else if (Array.isArray(data)) {
    data.forEach(song => { txt += formatSongText(song, vt) + '\n\n'; });
  } else {
    txt = formatSongText(data, vt);
  }
  return txt;
}

function formatSongText(song, vt) {
  let txt = '';
  txt += (song.number ? '#' + song.number + ' ' : '') + song.title + '\n';
  if (song.author) txt += 'By: ' + song.author + '\n';
  if (song.key) txt += 'Key: ' + song.key + '\n';
  txt += '-'.repeat(30) + '\n';
  (song.verses || []).forEach(v => {
    const vtype = vt[v.type || 'v'] || 'Verse';
    txt += '\n[' + vtype + ']\n';
    txt += v.lines.join('\n') + '\n';
  });
  return txt;
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type: type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── FIND & REPLACE ───
let frMatches = [];

function toggleFindReplace() {
  const panel = document.getElementById('findReplace');
  panel.classList.toggle('show');
  if (panel.classList.contains('show')) {
    document.getElementById('findInput').focus();
  }
}

function previewFindReplace() {
  const findText = document.getElementById('findInput').value;
  if (!findText) { clearFindReplace(); return; }
  const caseSensitive = document.getElementById('frCaseSensitive').checked;
  const searchTitles = document.getElementById('frTitles').checked;
  const searchVerses = document.getElementById('frVerses').checked;
  const searchAuthors = document.getElementById('frAuthors').checked;
  frMatches = [];
  CAT_ORDER.forEach(key => {
    SONGS[key].songs.forEach(song => {
      if (searchTitles && song.title) {
        const idx = findIndex(song.title, findText, caseSensitive);
        if (idx !== -1) frMatches.push({ song, field: 'title', cat: key, original: song.title, idx });
      }
      if (searchAuthors && song.author) {
        const idx = findIndex(song.author, findText, caseSensitive);
        if (idx !== -1) frMatches.push({ song, field: 'author', cat: key, original: song.author, idx });
      }
      if (searchVerses && song.verses) {
        song.verses.forEach((v, vi) => {
          v.lines.forEach((line, li) => {
            const idx = findIndex(line, findText, caseSensitive);
            if (idx !== -1) frMatches.push({ song, field: 'verse', cat: key, verseIdx: vi, lineIdx: li, original: line, idx });
          });
        });
      }
    });
  });
  const stats = document.getElementById('frStats');
  const results = document.getElementById('frResults');
  if (!frMatches.length) {
    stats.textContent = 'No matches found';
    results.innerHTML = '';
    results.classList.remove('show');
    return;
  }
  stats.textContent = frMatches.length + ' match' + (frMatches.length !== 1 ? 'es' : '') + ' found across ' + [...new Set(frMatches.map(m => m.song.id))].length + ' songs';
  results.classList.add('show');
  const replaceText = document.getElementById('replaceInput').value;
  let html = '';
  frMatches.slice(0, 50).forEach(m => {
    const highlighted = highlightMatch(m.original, findText, caseSensitive);
    const songInfo = m.song.number ? '#' + m.song.number + ' ' : '';
    const fieldLabel = m.field === 'verse' ? ' (v' + (m.verseIdx+1) + ')' : ' [' + m.field + ']';
    html += '<div class="match"><div><div class="match-song">' + esc(songInfo + m.song.title) + '</div><div class="match-text">' + esc(m.cat) + fieldLabel + ': ' + highlighted + '</div></div></div>';
  });
  if (frMatches.length > 50) html += '<div class="match"><div class="match-text">... and ' + (frMatches.length - 50) + ' more matches</div></div>';
  results.innerHTML = html;
}

function findIndex(text, find, caseSensitive) {
  if (caseSensitive) return text.indexOf(find);
  return text.toLowerCase().indexOf(find.toLowerCase());
}

function highlightMatch(text, find, caseSensitive) {
  if (!find) return esc(text);
  const escaped = esc(text);
  const findEsc = esc(find);
  if (caseSensitive) return escaped.replace(new RegExp(findEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<span class="highlight">' + findEsc + '</span>');
  return escaped.replace(new RegExp(findEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<span class="highlight">' + findEsc + '</span>');
}

function executeReplace() {
  if (!frMatches.length) { toast('No matches to replace', 'error'); return; }
  const findText = document.getElementById('findInput').value;
  const replaceText = document.getElementById('replaceInput').value;
  const caseSensitive = document.getElementById('frCaseSensitive').checked;
  const count = frMatches.length;
  frMatches.forEach(m => {
    if (m.field === 'title') {
      m.song.title = replaceAll(m.song.title, findText, replaceText, caseSensitive);
    } else if (m.field === 'author') {
      m.song.author = replaceAll(m.song.author, findText, replaceText, caseSensitive);
    } else if (m.field === 'verse') {
      m.song.verses[m.verseIdx].lines[m.lineIdx] = replaceAll(m.original, findText, replaceText, caseSensitive);
    }
  });
  saveSongs();
  previewFindReplace();
  renderAdminSongs();
  toast('Replaced ' + count + ' match' + (count !== 1 ? 'es' : ''), 'success');
}

function replaceAll(text, find, replace, caseSensitive) {
  if (caseSensitive) return text.split(find).join(replace);
  return text.split(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(replace);
}

function clearFindReplace() {
  document.getElementById('findInput').value = '';
  document.getElementById('replaceInput').value = '';
  document.getElementById('frStats').textContent = '';
  document.getElementById('frResults').innerHTML = '';
  document.getElementById('frResults').classList.remove('show');
  frMatches = [];
}

// ─── ADD / EDIT MODAL ───
function openAddModal() {
  document.getElementById('modalTitle').textContent = 'Add Song';
  document.getElementById('editSongId').value = '';
  document.getElementById('formCat').value = adminCat;
  document.getElementById('formNum').value = '';
  document.getElementById('formKey').value = '';
  document.getElementById('formTitle').value = '';
  document.getElementById('formAuthor').value = '';
  document.getElementById('formVerses').value = '';
  openModal('songModal');
}

function openEditModal(id) {
  let song = null, songCat = null;
  CAT_ORDER.forEach(k => {
    const found = SONGS[k].songs.find(s => s.id === id);
    if (found) { song = found; songCat = k; }
  });
  if (!song) return;
  document.getElementById('modalTitle').textContent = 'Edit Song';
  document.getElementById('editSongId').value = id;
  document.getElementById('formCat').value = songCat;
  document.getElementById('formNum').value = song.number || '';
  document.getElementById('formKey').value = song.key || '';
  document.getElementById('formTitle').value = song.title || '';
  document.getElementById('formAuthor').value = song.author || '';
  // Convert verses back to text
  let txt = '';
  (song.verses||[]).forEach(v => {
    if (txt) txt += '\n\n';
    const prefix = v.type === 'c' ? 'C: ' : v.type === 'b' ? 'B: ' : v.type === 'p' ? 'P: ' : 'V: ';
    txt += v.lines.map((l,i) => (i===0?prefix:'') + l).join('\n');
  });
  document.getElementById('formVerses').value = txt;
  openModal('songModal');
}

function parseVerses(text) {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
  return blocks.map(block => {
    const lines = block.split('\n').filter(l => l.trim());
    let type = 'v';
    const first = lines[0] || '';
    if (/^C:\s*/i.test(first)) { type = 'c'; lines[0] = first.replace(/^C:\s*/i, ''); }
    else if (/^B:\s*/i.test(first)) { type = 'b'; lines[0] = first.replace(/^B:\s*/i, ''); }
    else if (/^P:\s*/i.test(first)) { type = 'p'; lines[0] = first.replace(/^P:\s*/i, ''); }
    else if (/^V:\s*/i.test(first)) { lines[0] = first.replace(/^V:\s*/i, ''); }
    return { type, lines: lines.map(l => l.trim()).filter(Boolean) };
  }).filter(v => v.lines.length > 0);
}

function saveSong() {
  const editId = document.getElementById('editSongId').value;
  const cat = document.getElementById('formCat').value;
  const num = document.getElementById('formNum').value.trim();
  const key = document.getElementById('formKey').value.trim();
  const title = document.getElementById('formTitle').value.trim();
  const author = document.getElementById('formAuthor').value.trim();
  const versesText = document.getElementById('formVerses').value;

  if (!title) { toast('Title is required', 'error'); return; }

  const verses = parseVerses(versesText);
  const song = {
    id: editId || cat + '_' + Date.now(),
    title, author, number: num, key, verses
  };

  if (editId) {
    // Find and update
    let updated = false;
    CAT_ORDER.forEach(k => {
      const idx = SONGS[k].songs.findIndex(s => s.id === editId);
      if (idx >= 0) {
        if (k !== cat) {
          // Moved to different category
          SONGS[k].songs.splice(idx, 1);
          SONGS[cat].songs.push(song);
        } else {
          SONGS[k].songs[idx] = song;
        }
        updated = true;
      }
    });
    if (updated) toast('Song updated', 'success');
  } else {
    SONGS[cat].songs.push(song);
    toast('Song added', 'success');
  }

  // Re-number songs in category
  SONGS[cat].songs.forEach((s, i) => { if (!s.number) s.number = String(i + 1); });

  saveSongs();
  closeModal('songModal');
  adminCat = cat;
  renderAdminPanel();
  renderCategories();
}

// ─── DELETE ───
let pendingDeleteId = null;
function confirmDelete(id) {
  pendingDeleteId = id;
  let song = null;
  CAT_ORDER.forEach(k => {
    const found = SONGS[k].songs.find(s => s.id === id);
    if (found) song = found;
  });
  document.getElementById('confirmMsg').textContent = 'Delete "' + (song ? song.title : 'this song') + '"? This cannot be undone.';
  openModal('confirmModal');
  document.getElementById('confirmBtn').onclick = () => doDelete();
}

function doDelete() {
  if (!pendingDeleteId) return;
  CAT_ORDER.forEach(k => {
    const idx = SONGS[k].songs.findIndex(s => s.id === pendingDeleteId);
    if (idx >= 0) SONGS[k].songs.splice(idx, 1);
  });
  saveSongs();
  closeModal('confirmModal');
  pendingDeleteId = null;
  renderAdminPanel();
  renderCategories();
  toast('Song deleted', 'success');
}

// ─── MODALS ───
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── TOAST ───
function toast(msg, type) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 2500);
}

// ─── UTILS ───
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

init();
</script>
</body>
</html>'''

with open(r'C:\Users\Acer\Documents\Opencode\labu\index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('Written index.html: %d bytes (%.1f KB)' % (len(html), len(html)/1024))
