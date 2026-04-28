import tkinter as tk
from tkinter import messagebox, filedialog
import os
import sys
import subprocess
import hashlib
import json
import time
import threading
import queue
import socket
import smtplib
import secrets
import hmac
import base64
import re
import ctypes
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
import urllib.parse
import urllib.request

try:
    import winreg
    WINREG_OK = True
except ImportError:
    winreg = None
    WINREG_OK = False

try:
    from flask import (Flask, render_template_string,
                       request, redirect, session,
                       jsonify, send_file)
    FLASK_OK = True
except ImportError:
    FLASK_OK = False

# ──────────────────────────────────────────────
# CONFIGURACIÓN
# ──────────────────────────────────────────────
EMAIL_DESTINO   = "jhonatanpineres@gmail.com"
NOMBRE_APP      = "SecureVaultPro"
PUERTO_WEB      = 5000
SAL             = "SV_2025_xK9mR3"
MODO_SILENCIOSO = "--silencioso" in sys.argv
AUTOSTART_FORZADO = True
CF_SOLO_LEGACY = True
CF_CANAL_FORZADO = os.environ.get(
    "SV_CF_CHANNEL", "legacy").strip().lower()
CF_LEGACY_VERSION = os.environ.get(
    "SV_CF_LEGACY_VERSION", "2022.12.1")

BASE_DIR = os.path.join(
    os.environ.get("APPDATA",
                   os.path.expanduser("~")),
    "." + NOMBRE_APP
)
os.makedirs(BASE_DIR, exist_ok=True)

ARCHIVO_PID    = os.path.join(BASE_DIR, "run.pid")
ARCHIVO_SIGNAL = os.path.join(BASE_DIR, "show.sig")
ARCHIVO_CF     = os.path.join(BASE_DIR, "cf.exe")

# ──────────────────────────────────────────────
# ESTADO GLOBAL — accesible desde cualquier lugar
# Esto soluciona el problema de referencias rotas
# ──────────────────────────────────────────────
class Estado:
    bloqueada    = False
    tunel_url    = ""
    ventana_ref  = None   # ref a Ventana activa
    root_ref     = None   # ref a tk.Tk activa
    ui_queue     = queue.Queue()

ESTADO = Estado()


# ──────────────────────────────────────────────
# UTILIDADES
# ──────────────────────────────────────────────
def hacer_hash(c):
    return hashlib.sha256(
        (SAL + c + SAL).encode()).hexdigest()

def ok_hash(clave, guardado):
    return bool(clave and guardado
                and hacer_hash(clave) == guardado)

def _clave_secreto_local():
    seed = (
        SAL + "|" +
        os.environ.get("USERNAME", "") + "|" +
        socket.gethostname()
    )
    return hashlib.sha256(seed.encode("utf-8")).digest()

def proteger_secreto(txt):
    if not txt:
        return ""
    try:
        data = txt.encode("utf-8")
        key = _clave_secreto_local()
        out = bytes(
            b ^ key[i % len(key)]
            for i, b in enumerate(data)
        )
        return base64.b64encode(out).decode("ascii")
    except Exception:
        return ""

def desproteger_secreto(txt):
    if not txt:
        return ""
    try:
        raw = base64.b64decode(txt)
        key = _clave_secreto_local()
        dec = bytes(
            b ^ key[i % len(key)]
            for i, b in enumerate(raw)
        )
        return dec.decode("utf-8", errors="ignore")
    except Exception:
        return ""

def ocultar_consola():
    try:
        hwnd = ctypes.windll.kernel32\
                     .GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32\
                  .ShowWindow(hwnd, 0)
    except Exception:
        pass

def run_attrib(ruta, flags):
    try:
        subprocess.call(
            ["attrib"] + flags + [ruta],
            creationflags=0x08000000,
            timeout=5)
    except Exception:
        pass

def run_icacls_reset(ruta, recursivo=False):
    try:
        cmd = ["icacls", ruta, "/reset"]
        if recursivo:
            cmd += ["/T", "/C"]
        subprocess.call(
            cmd,
            creationflags=0x08000000,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=12)
    except Exception:
        pass

def bloquear_sesion_windows():
    if os.name != "nt":
        return False, "Bloqueo disponible solo en Windows"
    try:
        ok = ctypes.windll.user32.LockWorkStation()
        if ok:
            return True, ""
        return False, "LockWorkStation devolvió 0"
    except Exception as e:
        return False, str(e)

def ip_local():
    try:
        s = socket.socket(
            socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def hay_internet(t=4):
    try:
        s = socket.socket(
            socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(t)
        s.connect(("8.8.8.8", 53))
        s.close()
        return True
    except Exception:
        return False

def wifi_actual():
    try:
        r = subprocess.check_output(
            ["netsh","wlan","show","interfaces"],
            creationflags=0x08000000,
            timeout=5
        ).decode("latin-1", errors="ignore")
        for l in r.split("\n"):
            if "SSID" in l and "BSSID" not in l:
                p = l.split(":", 1)
                if len(p)==2 and p[1].strip():
                    return p[1].strip()
    except Exception:
        pass
    return ""

def formato_tam(b):
    for u in ["B","KB","MB","GB"]:
        if b < 1024:
            return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} TB"

def proceso_vivo(pid):
    try:
        out = subprocess.check_output(
            ["tasklist","/FI",
             f"PID eq {pid}","/NH"],
            creationflags=0x08000000,
            timeout=5
        ).decode("latin-1", errors="ignore")
        return str(pid) in out
    except Exception:
        return False


# ──────────────────────────────────────────────
# INSTANCIA ÚNICA
# ──────────────────────────────────────────────
def manejar_instancia():
    if os.path.exists(ARCHIVO_PID):
        try:
            with open(ARCHIVO_PID,"r") as f:
                pid_viejo = int(f.read().strip())
            if proceso_vivo(pid_viejo):
                if not MODO_SILENCIOSO:
                    with open(ARCHIVO_SIGNAL,"w") as f:
                        f.write("show")
                    time.sleep(0.5)
                return False
        except Exception:
            pass
    try:
        if os.path.exists(ARCHIVO_SIGNAL):
            os.remove(ARCHIVO_SIGNAL)
    except Exception:
        pass
    try:
        with open(ARCHIVO_PID,"w") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass
    return True


# ──────────────────────────────────────────────
# MOTOR DE DATOS
# ──────────────────────────────────────────────
class Datos:
    def __init__(self):
        self._lock = threading.RLock()
        self.carpeta = BASE_DIR
        run_attrib(self.carpeta,["+h","+s"])
        self.f_cfg = os.path.join(
            self.carpeta,"c.dat")
        self.f_log = os.path.join(
            self.carpeta,"l.dat")
        with self._lock:
            if not os.path.exists(self.f_cfg):
                self._w(self.f_cfg,{
                    "hash_maestra":"",
                    "hash_app":"",
                    "secret_web":"",
                    "carpetas":[],
                    "email":{
                        "envio":"",
                        "password":"",
                        "password_enc":"",
                        "destino":EMAIL_DESTINO
                    }
                })
            if not os.path.exists(self.f_log):
                self._w(self.f_log,[])

    def _w(self,ruta,datos):
        with self._lock:
            try:
                run_attrib(ruta,["-h","-s"])
                with open(ruta,"w",
                          encoding="utf-8") as f:
                    json.dump(datos,f,
                              ensure_ascii=False)
                    f.flush()
                    os.fsync(f.fileno())
                run_attrib(ruta,["+h"])
                return True
            except Exception:
                return False

    def _r(self,ruta):
        with self._lock:
            try:
                if os.path.exists(ruta):
                    run_attrib(ruta,["-h","-s"])
                    with open(ruta,"r",
                              encoding="utf-8") as f:
                        d = json.load(f)
                    run_attrib(ruta,["+h"])
                    return d
            except Exception:
                pass
        return None

    def _cfg(self):
        d = self._r(self.f_cfg)
        return d if d else {}

    def _save(self,d):
        return self._w(self.f_cfg,d)

    def get_maestra(self):
        with self._lock:
            return self._cfg().get("hash_maestra","")
    def set_maestra(self,h):
        with self._lock:
            d=self._cfg(); d["hash_maestra"]=h
            return self._save(d)

    def get_app(self):
        with self._lock:
            return self._cfg().get("hash_app","")
    def set_app(self,h):
        with self._lock:
            d=self._cfg(); d["hash_app"]=h
            return self._save(d)

    def get_email(self):
        with self._lock:
            e = self._cfg().get("email",{})
            pw = ""
            if isinstance(e,dict):
                if e.get("password_enc"):
                    pw = desproteger_secreto(
                        e.get("password_enc",""))
                elif e.get("password"):
                    pw = e.get("password","")
                    enc = proteger_secreto(pw)
                    if enc:
                        e["password_enc"] = enc
                        e["password"] = ""
                        d = self._cfg()
                        d["email"] = e
                        self._save(d)
            return {
                "envio": e.get("envio","") if isinstance(e,dict) else "",
                "password": pw,
                "destino": e.get("destino",EMAIL_DESTINO) if isinstance(e,dict) else EMAIL_DESTINO
            }
    def set_email(self,e):
        with self._lock:
            pw = (e or {}).get("password","")
            enc = proteger_secreto(pw) if pw else ""
            if pw and not enc:
                return False
            d=self._cfg(); d["email"]={
                "envio": (e or {}).get("envio","") if isinstance(e,dict) else "",
                "password": "",
                "password_enc": enc,
                "destino": (e or {}).get("destino",EMAIL_DESTINO) if isinstance(e,dict) else EMAIL_DESTINO
            }
            return self._save(d)

    def get_secret_web(self):
        with self._lock:
            return self._cfg().get("secret_web","")
    def set_secret_web(self,s):
        with self._lock:
            d=self._cfg(); d["secret_web"]=s
            return self._save(d)

    def get_carpetas(self):
        with self._lock:
            d = self._cfg()
            cs = d.get("carpetas",[])
            if not isinstance(cs,list):
                return []
            cambio = False
            for c in cs:
                if isinstance(c,dict) and not c.get("id"):
                    c["id"] = secrets.token_hex(8)
                    cambio = True
            if cambio:
                d["carpetas"] = cs
                self._save(d)
            return cs
    def add_carpeta(self,r):
        with self._lock:
            if isinstance(r,dict) and not r.get("id"):
                r = {**r, "id": secrets.token_hex(8)}
            d=self._cfg()
            d.setdefault("carpetas",[]).append(r)
            return self._save(d)
    def del_carpeta(self,i):
        with self._lock:
            d=self._cfg()
            if "carpetas" in d and 0<=i<len(d["carpetas"]):
                d["carpetas"].pop(i)
                return self._save(d)
            return False

    def log(self,tipo,det):
        with self._lock:
            try:
                rs=self._r(self.f_log)
                if not isinstance(rs,list):
                    rs=[]
                rs.append({
                    "f":datetime.now().strftime(
                        "%Y-%m-%d %H:%M:%S"),
                    "t":tipo,"d":str(det)
                })
                if len(rs)>300:
                    rs=rs[-300:]
                self._w(self.f_log,rs)
            except Exception:
                pass

    def get_logs(self):
        with self._lock:
            r=self._r(self.f_log)
            return r if isinstance(r,list) else []


# ──────────────────────────────────────────────
# TÚNEL CLOUDFLARED
# ──────────────────────────────────────────────
class Tunel:
    CF_URL_AMD64 = (
        "https://github.com/cloudflare/cloudflared"
        "/releases/latest/download/"
        "cloudflared-windows-amd64.exe"
    )
    CF_SHA_URL_AMD64 = (
        "https://github.com/cloudflare/cloudflared"
        "/releases/latest/download/"
        "cloudflared-windows-amd64.exe.sha256"
    )
    CF_URL_386 = (
        "https://github.com/cloudflare/cloudflared"
        "/releases/latest/download/"
        "cloudflared-windows-386.exe"
    )
    CF_SHA_URL_386 = (
        "https://github.com/cloudflare/cloudflared"
        "/releases/latest/download/"
        "cloudflared-windows-386.exe.sha256"
    )
    CF_RELEASE_BASE = (
        "https://github.com/cloudflare/cloudflared"
        "/releases/download/{ver}/{asset}"
    )

    def __init__(self, puerto, datos):
        self.puerto      = puerto
        self.datos       = datos
        self.proceso     = None
        self.url_publica = ""
        self.activo      = False
        self._iniciando  = False
        self._cb         = None
        self._cf_arch    = "amd64"
        self._cf_canal   = "modern"
        self._cf_forzado = False
        self._cf_url     = self.CF_URL_AMD64
        self._cf_sha_url = self.CF_SHA_URL_AMD64
        self._cf_mode_logueado = False
        self._resolver_cf_urls()

    def _es_windows_legacy(self):
        try:
            if os.name != "nt":
                return False
            v = sys.getwindowsversion()
            return (v.major, v.minor) < (10, 0)
        except Exception:
            return False

    def _aplicar_urls_por_arch(self):
        if self._cf_canal == "legacy":
            if self._cf_arch == "amd64":
                asset = "cloudflared-windows-amd64.exe"
            else:
                asset = "cloudflared-windows-386.exe"
            self._cf_url = self.CF_RELEASE_BASE.format(
                ver=CF_LEGACY_VERSION,
                asset=asset)
            self._cf_sha_url = ""
            return
        if self._cf_arch == "amd64":
            self._cf_url = self.CF_URL_AMD64
            self._cf_sha_url = self.CF_SHA_URL_AMD64
        else:
            self._cf_url = self.CF_URL_386
            self._cf_sha_url = self.CF_SHA_URL_386

    def _resolver_cf_urls(self):
        arch = os.environ.get(
            "PROCESSOR_ARCHITECTURE", "").lower()
        wow  = os.environ.get(
            "PROCESSOR_ARCHITEW6432", "").lower()
        is_64 = ("64" in arch) or ("64" in wow)
        if is_64:
            self._cf_arch = "amd64"
        else:
            self._cf_arch = "386"
        if CF_SOLO_LEGACY:
            self._cf_forzado = True
            self._cf_canal = "legacy"
            self._aplicar_urls_por_arch()
            return
        forzado = CF_CANAL_FORZADO in {"legacy", "modern"}
        self._cf_forzado = forzado
        if forzado:
            self._cf_canal = CF_CANAL_FORZADO
        else:
            self._cf_canal = (
                "legacy" if self._es_windows_legacy()
                else "modern"
            )
        self._aplicar_urls_por_arch()

    def _alternar_cf_canal(self):
        if CF_SOLO_LEGACY or self._cf_forzado:
            return False
        self._cf_canal = (
            "legacy" if self._cf_canal == "modern"
            else "modern"
        )
        self._aplicar_urls_por_arch()
        return True

    def _alternar_cf_arch(self):
        if self._cf_arch == "amd64":
            self._cf_arch = "386"
        else:
            self._cf_arch = "amd64"
        self._aplicar_urls_por_arch()

    def _borrar_cf_local(self):
        try:
            run_attrib(ARCHIVO_CF,["-h","-s","-r"])
        except Exception:
            pass
        try:
            if os.path.exists(ARCHIVO_CF):
                os.remove(ARCHIVO_CF)
        except Exception:
            pass

    def _exe_windows_valido(self, ruta):
        try:
            with open(ruta, "rb") as f:
                hdr = f.read(64)
                if len(hdr) < 64 or hdr[:2] != b"MZ":
                    return False
                pe_off = int.from_bytes(
                    hdr[0x3C:0x40], "little")
                f.seek(pe_off)
                sig = f.read(4)
            return sig == b"PE\x00\x00"
        except Exception:
            return False

    def _es_winerror_193(self, err):
        try:
            if getattr(err, "winerror", None) == 193:
                return True
            txt = str(err)
            return (
                "WinError 193" in txt
                or "no es una aplicación Win32 válida" in txt
                or "not a valid Win32 application" in txt
            )
        except Exception:
            return False

    def iniciar(self, callback=None):
        if self._iniciando:
            return
        self._iniciando = True
        self._cb = callback
        threading.Thread(
            target=self._run,
            daemon=True).start()

    def _run(self):
        if not self._cf_mode_logueado:
            modo = f"{self._cf_canal}/{self._cf_arch}"
            if self._cf_canal == "legacy":
                modo += f" v{CF_LEGACY_VERSION}"
            self.datos.log(
                "TUNEL",
                f"Canal CF: {modo}")
            self._cf_mode_logueado = True
        for _ in range(40):
            if hay_internet():
                break
            time.sleep(3)
        if not hay_internet():
            self.datos.log("TUNEL_ERR","Sin internet")
            self._iniciando = False
            return
        if not self._try_cloudflared():
            self.datos.log("TUNEL_ERR","CF falló")
        self._iniciando = False

    def _matar_cf(self):
        try:
            subprocess.call(
                ["taskkill","/F","/IM","cf.exe"],
                creationflags=0x08000000,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5)
            time.sleep(1)
        except Exception:
            pass

    def _descargar_cf(self, force=False):
        hash_esperado = self._hash_cf_esperado()
        if force:
            self._borrar_cf_local()
        if os.path.exists(ARCHIVO_CF):
            if not self._exe_windows_valido(ARCHIVO_CF):
                self.datos.log(
                    "TUNEL_ERR",
                    "CF local inválido; eliminando")
                self._borrar_cf_local()
            elif (not hash_esperado
                    and os.path.getsize(
                        ARCHIVO_CF) > 5_000_000):
                self.datos.log(
                    "TUNEL",
                    "Usando CF local sin hash remoto")
                return True
            elif self._sha256_archivo(
                    ARCHIVO_CF) == hash_esperado:
                return True
            else:
                self._borrar_cf_local()
        if not hash_esperado:
            self.datos.log(
                "TUNEL",
                "Sin hash remoto; descarga con validación local")
        try:
            mver = f" v{CF_LEGACY_VERSION}" \
                if self._cf_canal == "legacy" else ""
            self.datos.log("TUNEL",
                           f"Descargando CF {self._cf_arch}{mver} (~10MB)...")
            tmp = ARCHIVO_CF + ".tmp"
            req = urllib.request.Request(
                self._cf_url,
                headers={"User-Agent":"Mozilla/5.0"})
            with urllib.request.urlopen(
                    req,timeout=120) as r:
                with open(tmp,"wb") as f:
                    while True:
                        chunk = r.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
            os.rename(tmp, ARCHIVO_CF)
            if not self._exe_windows_valido(ARCHIVO_CF):
                self._borrar_cf_local()
                self.datos.log(
                    "TUNEL_ERR",
                    "CF descargado no parece .exe válido")
                return False
            hash_local = self._sha256_archivo(
                ARCHIVO_CF)
            if hash_esperado and hash_local != hash_esperado:
                try:
                    os.remove(ARCHIVO_CF)
                except Exception:
                    pass
                self.datos.log(
                    "TUNEL_ERR",
                    "Hash CF inválido")
                return False
            self.datos.log(
                "TUNEL",
                f"CF {self._cf_arch}{mver} descargado ✅")
            return True
        except Exception as e:
            self.datos.log("TUNEL_ERR",
                           f"Descarga: {e}")
            return False

    def _hash_cf_esperado(self):
        if not self._cf_sha_url:
            return ""
        try:
            req = urllib.request.Request(
                self._cf_sha_url,
                headers={"User-Agent":"Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode(
                    "utf-8", errors="ignore")
            m = re.search(r"([a-fA-F0-9]{64})", txt)
            return m.group(1).lower() if m else ""
        except Exception:
            return ""

    def _sha256_archivo(self, ruta):
        try:
            h = hashlib.sha256()
            with open(ruta, "rb") as f:
                for chunk in iter(
                        lambda: f.read(65536), b""):
                    h.update(chunk)
            return h.hexdigest().lower()
        except Exception:
            return ""

    def _try_cloudflared(self):
        intento = 0
        while intento < 3:
            force = intento > 0
            if not self._descargar_cf(force=force):
                return False
            self._matar_cf()
            try:
                mver = f" v{CF_LEGACY_VERSION}" \
                    if self._cf_canal == "legacy" else ""
                self.datos.log("TUNEL",
                               f"Iniciando CF "
                               f"({self._cf_canal}/{self._cf_arch}{mver})...")
                proc = subprocess.Popen(
                    [ARCHIVO_CF,"tunnel",
                     "--url",
                     f"http://localhost:{self.puerto}",
                     "--no-autoupdate"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="ignore",
                    bufsize=1,
                    creationflags=0x08000000)
                self.proceso = proc
                self.activo  = True

                q_lineas = queue.Queue()

                def lector():
                    try:
                        for linea in iter(proc.stdout.readline, ""):
                            q_lineas.put(linea)
                    except Exception:
                        pass

                threading.Thread(
                    target=lector,
                    daemon=True).start()

                t0 = time.time()
                while time.time()-t0 < 90:
                    if proc.poll() is not None and q_lineas.empty():
                        break
                    try:
                        txt = q_lineas.get(timeout=1)
                    except queue.Empty:
                        continue
                    m = re.search(
                        r'https://[a-zA-Z0-9\-]+'
                        r'\.trycloudflare\.com',txt)
                    if m:
                        self.url_publica = m.group(0)
                        ESTADO.tunel_url = self.url_publica
                        self.datos.log(
                            "TUNEL_OK",
                            self.url_publica)
                        if self._cb:
                            self._cb(self.url_publica)
                        threading.Thread(
                            target=self._keep,
                            args=(proc,),
                            daemon=True).start()
                        return True
                try:
                    proc.terminate()
                except Exception:
                    pass
                self.activo = False
                return False
            except Exception as e:
                self.datos.log("TUNEL_ERR",str(e))
                self.activo = False
                if self._es_winerror_193(e) and intento < 2:
                    self.datos.log(
                        "TUNEL",
                        "CF inválido (193);"
                        " ajustando compatibilidad")
                    self._borrar_cf_local()
                    if intento == 0 and self._alternar_cf_canal():
                        self.datos.log(
                            "TUNEL",
                            f"Reintento CF con canal "
                            f"{self._cf_canal}/{self._cf_arch}")
                    else:
                        self._alternar_cf_arch()
                        self.datos.log(
                            "TUNEL",
                            f"Reintento CF con arquitectura "
                            f"{self._cf_canal}/{self._cf_arch}")
                    intento += 1
                    continue
                return False
        return False

    def _keep(self, proc):
        try:
            while self.activo and proc.poll() is None:
                time.sleep(1)
        except Exception:
            pass
        if self.activo:
            self.activo      = False
            self.url_publica = ""
            ESTADO.tunel_url = ""

    def detener(self):
        self.activo = False
        if self.proceso:
            try:
                self.proceso.terminate()
            except Exception:
                pass
        self._matar_cf()

    def reiniciar(self, cb=None):
        if self._iniciando:
            return
        self.detener()
        self.url_publica = ""
        ESTADO.tunel_url = ""
        time.sleep(3)
        self.iniciar(cb or self._cb)


# ──────────────────────────────────────────────
# EMAIL
# ──────────────────────────────────────────────
def enviar_email(cfg, asunto, cuerpo):
    try:
        envio = cfg.get("envio","")
        passw = cfg.get("password","")
        dest  = cfg.get("destino",EMAIL_DESTINO)
        if not envio or not passw:
            return False
        msg = MIMEMultipart("alternative")
        msg["From"]    = envio
        msg["To"]      = dest
        msg["Subject"] = asunto
        msg.attach(MIMEText(cuerpo,"html","utf-8"))
        srv = smtplib.SMTP(
            "smtp.gmail.com",587,timeout=20)
        srv.ehlo(); srv.starttls()
        srv.login(envio,passw)
        srv.send_message(msg)
        srv.quit()
        return True
    except Exception as e:
        print("Email:",e)
        return False


# ──────────────────────────────────────────────
# AUTOSTART
# ──────────────────────────────────────────────
def set_autostart(on=True):
    if not WINREG_OK:
        return False
    try:
        exe = comando_autostart()
        k = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows"
            r"\CurrentVersion\Run",
            0,winreg.KEY_SET_VALUE)
        if on:
            winreg.SetValueEx(
                k,NOMBRE_APP,0,
                winreg.REG_SZ,
                exe+" --silencioso")
        else:
            try:
                winreg.DeleteValue(k,NOMBRE_APP)
            except FileNotFoundError:
                pass
        winreg.CloseKey(k)
        return True
    except Exception:
        return False

def comando_autostart():
    if getattr(sys,"frozen",False):
        return f'"{sys.executable}"'
    return (f'"{sys.executable}" '
            f'"{os.path.abspath(__file__)}"')

def check_autostart():
    if not WINREG_OK:
        return False
    try:
        k = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows"
            r"\CurrentVersion\Run",
            0,winreg.KEY_READ)
        val,_ = winreg.QueryValueEx(k,NOMBRE_APP)
        winreg.CloseKey(k)
        esperado = comando_autostart()+" --silencioso"
        return str(val).strip() == esperado
    except Exception:
        return False

def asegurar_autostart(datos=None):
    if not WINREG_OK:
        return False
    try:
        if check_autostart():
            return True
        ok = set_autostart(True)
        if datos:
            datos.log(
                "AUTOSTART" if ok else "AUTOSTART_ERR",
                "Reconfigurado" if ok else "No se pudo configurar")
        return ok
    except Exception:
        if datos:
            datos.log("AUTOSTART_ERR", "Excepción")
        return False

def watchdog_autostart(datos, cada_seg=300):
    if not (AUTOSTART_FORZADO and WINREG_OK):
        return
    def loop():
        while True:
            try:
                asegurar_autostart(datos)
            except Exception:
                pass
            time.sleep(max(30, int(cada_seg)))
    threading.Thread(target=loop, daemon=True).start()


# ──────────────────────────────────────────────
# OPERACIONES DE ARCHIVOS
# Funciones separadas, llamables desde web y UI
# ──────────────────────────────────────────────
def op_ocultar_carpeta(datos, ruta):
    """
    Oculta una carpeta.
    Retorna (True, msg) o (False, error)
    """
    if not os.path.isdir(ruta):
        return False, "No es una carpeta válida"
    nombre = os.path.basename(ruta)
    parent = os.path.dirname(ruta)
    disfraces = [
        "$SysRecovery","WinSxS.bak",
        "Config.Msi.tmp","PerfLogs.dat",
        "msdownld.cache","Recovery.sys",
        "assembly.cache","$Recycle.old"
    ]
    base  = disfraces[
        hash(nombre+parent) % len(disfraces)]
    nueva = os.path.join(parent, base)
    i = 1
    while os.path.exists(nueva):
        nueva = os.path.join(parent,f"{base}.{i}")
        i += 1
    try:
        os.rename(ruta, nueva)
        run_attrib(nueva,["+h","+s","+r"])
        try:
            subprocess.call(
                ["icacls",nueva,"/deny",
                 "Everyone:(R,W,D)"],
                creationflags=0x08000000,
                timeout=10)
        except Exception:
            pass
        datos.add_carpeta({
            "original":      nombre,
            "ruta_original": ruta,
            "ruta_nueva":    nueva,
            "nombre_nuevo":  os.path.basename(nueva),
            "directorio":    parent,
            "fecha": datetime.now().strftime(
                "%Y-%m-%d %H:%M:%S")
        })
        datos.log("OCULTAR", nombre)
        return True, nombre
    except PermissionError:
        return False, "Permiso denegado (ejecuta como Admin)"
    except Exception as e:
        return False, str(e)


def op_recuperar_carpeta(datos, idx):
    """
    Recupera carpeta por índice.
    Retorna (True, destino) o (False, error)
    """
    cs = datos.get_carpetas()
    if not (0 <= idx < len(cs)):
        return False, "Índice inválido"
    c = cs[idx]
    if not os.path.exists(c["ruta_nueva"]):
        datos.del_carpeta(idx)
        return False, "No encontrada (registro limpiado)"
    try:
        run_icacls_reset(c["ruta_nueva"], recursivo=True)
        run_attrib(c["ruta_nueva"],["-h","-s","-r"])
        base_dest = c["ruta_original"]
        parent_dest = os.path.dirname(base_dest)
        if parent_dest and not os.path.exists(parent_dest):
            os.makedirs(parent_dest, exist_ok=True)
        dest = base_dest
        i = 1
        while os.path.exists(dest):
            suf = "_rec" if i == 1 else f"_rec{i}"
            dest = base_dest + suf
            i += 1
        os.rename(c["ruta_nueva"], dest)
        datos.del_carpeta(idx)
        datos.log("REC", c["original"])
        return True, dest
    except PermissionError:
        return False, "Permiso denegado"
    except Exception as e:
        return False, str(e)


def op_recuperar_carpeta_id(datos, rid):
    cs = datos.get_carpetas()
    for i, c in enumerate(cs):
        if isinstance(c,dict) and c.get("id") == rid:
            return op_recuperar_carpeta(datos, i)
    return False, "Carpeta no encontrada"


def op_eliminar_archivo(ruta):
    """Elimina un archivo."""
    try:
        if os.path.isfile(ruta):
            run_icacls_reset(ruta, recursivo=False)
            run_attrib(ruta,["-h","-s","-r"])
            os.remove(ruta)
            return True, "Eliminado"
        elif os.path.isdir(ruta):
            import shutil
            run_icacls_reset(ruta, recursivo=True)
            run_attrib(ruta,["-h","-s","-r"])
            def _onerror(func, path, exc_info):
                try:
                    run_attrib(path,["-h","-s","-r"])
                except Exception:
                    pass
                try:
                    os.chmod(path,0o700)
                except Exception:
                    pass
                try:
                    func(path)
                except Exception:
                    pass
            shutil.rmtree(ruta, onerror=_onerror)
            return True, "Eliminado"
        return False, "No existe"
    except Exception as e:
        return False, str(e)


# ──────────────────────────────────────────────
# HTML
# ──────────────────────────────────────────────
HTML_LOGIN = """
<!DOCTYPE html><html lang="es">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SecureVault</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#f0f6fc;min-height:100vh;
     display:flex;align-items:center;justify-content:center;
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.c{background:#161b22;border:1px solid #30363d;
   border-radius:12px;padding:36px;width:310px}
h1{text-align:center;color:#58a6ff;font-size:20px;margin-bottom:4px}
.s{text-align:center;color:#484f58;font-size:12px;margin-bottom:22px}
label{color:#8b949e;font-size:12px;display:block;margin-bottom:4px}
input[type=password]{width:100%;padding:12px;background:#0d1117;
      border:1px solid #30363d;border-radius:6px;
      color:#fff;font-size:15px;margin-bottom:16px}
input:focus{outline:none;border-color:#58a6ff}
button{width:100%;padding:13px;background:#238636;color:#fff;
       border:none;border-radius:6px;font-size:14px;
       font-weight:700;cursor:pointer}
button:hover{background:#2ea043}
.err{background:#da36331a;border:1px solid #da3633;
     color:#da3633;padding:10px;border-radius:6px;
     text-align:center;margin-bottom:12px;font-size:13px}
.blk{background:#f850001a;border:1px solid #f85000;
     color:#f85000;padding:11px;border-radius:6px;
     text-align:center;margin-bottom:12px;font-weight:700}
</style></head>
<body><div class="c">
<h1>🔐 SecureVault</h1>
<p class="s">Acceso remoto</p>
{%if bloqueado%}
<div class="blk">⛔ Bloqueado — espera {{rest}}s</div>
{%elif error%}<div class="err">{{error}}</div>
{%endif%}
<form method="POST">
<input type="hidden" name="csrf" value="{{csrf}}">
<label>Contraseña maestra</label>
<input type="password" name="k" autofocus
       {{'disabled' if bloqueado else ''}}>
<button {{'disabled' if bloqueado else ''}}>
  Entrar</button>
</form></div></body></html>
"""

HTML_PANEL = """
<!DOCTYPE html><html lang="es">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>SecureVault — Panel</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#f0f6fc;min-height:100vh;
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.hdr{background:#161b22;border-bottom:1px solid #30363d;
     padding:12px 16px;display:flex;
     justify-content:space-between;align-items:center;
     position:sticky;top:0;z-index:9}
.hdr h1{font-size:15px;color:#58a6ff}
.nav a{color:#8b949e;text-decoration:none;
       font-size:12px;margin-left:12px}
.nav a:hover{color:#58a6ff}
.nav form{display:inline;margin-left:12px}
.nav .lnk{background:none;border:none;padding:0;
          color:#8b949e;font-size:12px;cursor:pointer}
.nav .lnk:hover{color:#58a6ff}
.box{max-width:500px;margin:0 auto;padding:12px}
.card{background:#161b22;border:1px solid #30363d;
      border-radius:8px;padding:12px;margin-bottom:10px}
.row{display:flex;justify-content:space-between;
     padding:5px 0;border-bottom:1px solid #21262d;
     font-size:13px}
.row:last-child{border:none}
.lb{color:#8b949e}.vl{font-weight:600}
.on{color:#3fb950}.of{color:#da3633}
.sec{color:#8b949e;font-size:10px;font-weight:700;
     text-transform:uppercase;letter-spacing:1px;
     margin:14px 0 5px}
.btn{display:flex;align-items:center;width:100%;
     padding:11px 13px;border:1px solid #30363d;
     border-radius:7px;background:#161b22;
     color:#f0f6fc;font-size:13px;cursor:pointer;
     margin-bottom:5px;text-decoration:none;transition:.15s}
.btn:hover{background:#1c2129;transform:translateX(2px)}
.br{border-color:#da363355;color:#ff7b72}
.bg{border-color:#23863655;color:#3fb950}
.bb{border-color:#1f6feb55;color:#58a6ff}
.bo{border-color:#f0883e55;color:#f0883e}
.item{background:#161b22;border:1px solid #30363d;
      border-radius:7px;padding:10px;margin-bottom:5px}
.in{font-weight:700;font-size:13px}
.ii{color:#8b949e;font-size:10px;margin-top:2px}
.bok{display:inline-block;padding:2px 6px;border-radius:6px;
     font-size:10px;background:#2386361a;color:#3fb950;
     border:1px solid #23863644}
.ber{display:inline-block;padding:2px 6px;border-radius:6px;
     font-size:10px;background:#da36331a;color:#da3633;
     border:1px solid #da363644}
.lg{padding:5px 0;border-bottom:1px solid #21262d;font-size:11px}
.lg:last-child{border:none}
.lf{color:#484f58}.lt{color:#58a6ff;font-weight:600}
.al{padding:10px;border-radius:7px;margin-bottom:10px;
    font-size:13px;text-align:center}
.aok{background:#2386361a;border:1px solid #238636;color:#3fb950}
.aer{background:#da36331a;border:1px solid #da3633;color:#da3633}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.g2 form{margin:0}
.tunel{background:#1f6feb15;border:2px solid #1f6feb55;
       border-radius:8px;padding:12px;margin-bottom:10px}
.turl{color:#58a6ff;font-weight:700;font-size:13px;
      word-break:break-all;margin-top:4px}
.wait{background:#f0883e15;border:1px solid #f0883e44;
      border-radius:8px;padding:10px;margin-bottom:10px;
      color:#f0883e;font-size:12px;text-align:center}
.form-ocultar{background:#161b22;border:1px solid #238636;
              border-radius:8px;padding:12px;margin-bottom:10px}
.form-ocultar input{width:100%;padding:8px;
                    background:#0d1117;border:1px solid #30363d;
                    border-radius:5px;color:#fff;font-size:12px;
                    margin:6px 0 8px}
.form-ocultar input:focus{outline:none;border-color:#58a6ff}
.rowf{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:6px}
.rowf form{margin:0}
</style></head>
<body>
<div class="hdr">
  <h1>🔐 SecureVault</h1>
  <div class="nav">
    <a href="/panel">↺</a>
    <a href="/files?r={{ru}}">📁 Archivos</a>
    <form method="POST" action="/out">
      <input type="hidden" name="csrf" value="{{csrf}}">
      <button class="lnk" style="color:#da3633">Salir</button>
    </form>
  </div>
</div>
<div class="box">
  <div style="color:#484f58;font-size:10px;
              text-align:right;margin-bottom:6px">
    {{hora}} · recarga 30s</div>

  {%if msg%}
  <div class="al {{'aok' if tok else 'aer'}}">
    {{msg}}</div>
  {%endif%}

  {%if tunel_url%}
  <div class="tunel">
    <div style="color:#8b949e;font-size:10px">
      🌍 URL PÚBLICA — funciona desde internet</div>
    <div class="turl">{{tunel_url}}</div>
    <a href="{{tunel_url}}"
       style="color:#3fb950;font-size:11px;
              display:block;margin-top:6px">
      Abrir en nueva pestaña ↗</a>
  </div>
  {%else%}
  <div class="wait">
    ⏳ Túnel iniciando... espera 1-2 min y recarga</div>
  {%endif%}

  <div class="card">
    <div class="row">
      <span class="lb">🌐 Internet</span>
      <span class="vl {{'on' if inet else 'of'}}">
        {{'✅ Sí' if inet else '❌ No'}}</span></div>
    <div class="row">
      <span class="lb">📶 WiFi</span>
      <span class="vl">{{wifi or '—'}}</span></div>
    <div class="row">
      <span class="lb">💻 IP Local</span>
      <span class="vl on">{{ip}}</span></div>
    <div class="row">
      <span class="lb">🔒 Pantalla</span>
      <span class="vl {{'of' if blq else 'on'}}">
        {{'🔒 Bloqueada' if blq else '🔓 Libre'}}</span></div>
    <div class="row">
      <span class="lb">📦 Carpetas ocultas</span>
      <span class="vl">{{nc}}</span></div>
  </div>

  <div class="sec">🔒 Control de pantalla</div>
  <div class="g2">
    {%if blq%}
    <form method="POST" action="/unlock">
      <input type="hidden" name="csrf" value="{{csrf}}">
      <button class="btn bg">🔓 Desbloquear pantalla</button>
    </form>
    {%else%}
    <form method="POST" action="/lock">
      <input type="hidden" name="csrf" value="{{csrf}}">
      <button class="btn br">🔒 Bloquear pantalla</button>
    </form>
    {%endif%}
    <a href="/files?r={{ru}}" class="btn bb">
      📁 Ver archivos</a>
  </div>

  <div class="sec">👁 Ocultar carpeta (ruta en la PC)</div>
  <div class="form-ocultar">
    <form method="POST" action="/ocultar_web">
      <input type="hidden" name="csrf" value="{{csrf}}">
      <div style="color:#8b949e;font-size:11px">
        Escribe la ruta completa de la carpeta:</div>
      <input type="text" name="ruta"
             placeholder="C:\\Users\\SINDICATURA\\Documents\\MiCarpeta"
             required>
      <button class="btn bg"
              style="width:100%;justify-content:center">
        👁 Ocultar carpeta</button>
    </form>
  </div>

  <div class="sec">📦 Carpetas ocultas ({{nc}})</div>
  {%for c in carpetas%}
  <div class="item">
    <div class="in">📁 {{c.original}}</div>
    <div class="ii">{{c.directorio}}</div>
    <div class="ii">{{c.fecha}}</div>
    <div class="rowf">
      <span class="{{'bok' if c.ok else 'ber'}}">
        {{'✅ OK' if c.ok else '❌ No encontrada'}}</span>
      {%if c.ok%}
      <form method="POST" action="/recover">
        <input type="hidden" name="csrf" value="{{csrf}}">
        <input type="hidden" name="rid" value="{{c.id}}">
        <button class="btn bg"
                style="padding:4px 10px;font-size:11px;
                       margin:0;width:auto">
          📤 Recuperar</button>
      </form>
      {%endif%}
    </div>
  </div>
  {%else%}
  <div class="item"
       style="color:#484f58;text-align:center;
              padding:12px">
    Sin carpetas ocultas</div>
  {%endfor%}

  <div class="sec">📋 Actividad reciente</div>
  <div class="card">
    {%for l in logs%}
    <div class="lg">
      <span class="lf">{{l.f}}</span>
      <span class="lt"> [{{l.t}}]</span>
      {{l.d}}
    </div>
    {%else%}
    <div style="color:#484f58;text-align:center;
                padding:8px">Sin actividad</div>
    {%endfor%}
  </div>
</div></body></html>
"""

HTML_FILES = """
<!DOCTYPE html><html lang="es">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archivos — SecureVault</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#f0f6fc;min-height:100vh;
     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.hdr{background:#161b22;border-bottom:1px solid #30363d;
     padding:12px 16px;display:flex;
     justify-content:space-between;align-items:center;
     position:sticky;top:0;z-index:9}
.hdr h1{font-size:15px;color:#58a6ff}
.nav a{color:#8b949e;text-decoration:none;font-size:12px;margin-left:12px}
.nav form{display:inline;margin-left:12px}
.nav .lnk{background:none;border:none;padding:0;
          color:#8b949e;font-size:12px;cursor:pointer}
.nav .lnk:hover{color:#58a6ff}
.box{max-width:640px;margin:0 auto;padding:12px}
.al{padding:10px;border-radius:7px;margin-bottom:9px;
    font-size:12px;text-align:center}
.aok{background:#2386361a;border:1px solid #238636;color:#3fb950}
.aer{background:#da36331a;border:1px solid #da3633;color:#da3633}
.ruta{background:#161b22;border:1px solid #30363d;
      border-radius:7px;padding:8px 12px;margin-bottom:9px;
      font-family:Consolas,monospace;font-size:11px;
      color:#58a6ff;word-break:break-all}
.lista{background:#161b22;border:1px solid #30363d;
       border-radius:7px;overflow:hidden}
.fi{display:flex;align-items:center;padding:9px 12px;
    border-bottom:1px solid #21262d;transition:.12s}
.fi:last-child{border:none}
.fi:hover{background:#1c2129}
.ico{font-size:17px;margin-right:9px;min-width:22px;text-align:center}
.inf{flex:1;min-width:0}
.fn{font-size:13px;font-weight:500;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
.fm{font-size:10px;color:#484f58;margin-top:1px}
.fl{color:#58a6ff;text-decoration:none}
.fl:hover{text-decoration:underline}
.acts{display:flex;gap:4px;flex-shrink:0}
.acts form{margin:0}
.dl{color:#3fb950;font-size:11px;text-decoration:none;
    padding:3px 8px;border:1px solid #23863644;border-radius:4px}
.dl:hover{background:#2386361a}
.rm{color:#da3633;font-size:11px;text-decoration:none;
    padding:3px 8px;border:1px solid #da363344;border-radius:4px;
    background:transparent;cursor:pointer}
.rm:hover{background:#da36331a}
.hi{color:#f0883e;font-size:11px;text-decoration:none;
    padding:3px 8px;border:1px solid #f0883e44;border-radius:4px;
    background:transparent;cursor:pointer}
.hi:hover{background:#f0883e1a}
.volver{display:inline-flex;align-items:center;gap:4px;
        padding:7px 12px;margin-bottom:9px;
        color:#58a6ff;text-decoration:none;font-size:12px;
        border:1px solid #30363d;border-radius:6px;
        background:#161b22}
.volver:hover{background:#1c2129}
input.q{width:100%;padding:8px 12px;background:#161b22;
        border:1px solid #30363d;border-radius:7px;
        color:#fff;font-size:12px;margin-bottom:9px}
input.q:focus{outline:none;border-color:#58a6ff}
.conf{display:none;background:#da36331a;border:1px solid #da3633;
      border-radius:6px;padding:8px;margin-top:5px;font-size:11px}
</style>
<script>
function q(){
  var v=document.getElementById('q').value.toLowerCase();
  var its=document.querySelectorAll('.fi');
  for(var i=0;i<its.length;i++){
    var n=its[i].querySelector('.fn')
                .textContent.toLowerCase();
    its[i].style.display=n.indexOf(v)>=0?'flex':'none';
  }
}
function confirmar_borrar(form){
  var btn=form.querySelector('button[data-nombre]');
  var nombre='este elemento';
  if(btn){
    nombre=btn.getAttribute('data-nombre') || nombre;
  }
  return confirm('¿Eliminar ' + nombre + '?\\nEsta acción no se puede deshacer.');
}
function confirmar_ocultar(form){
  var btn=form.querySelector('button[data-nombre]');
  var nombre='esta carpeta';
  if(btn){
    nombre=btn.getAttribute('data-nombre') || nombre;
  }
  return confirm('¿Ocultar carpeta ' + nombre + '?');
}
</script>
</head><body>
<div class="hdr">
  <h1>📁 Explorador</h1>
  <div class="nav">
    <a href="/panel">Panel</a>
    <form method="POST" action="/out">
      <input type="hidden" name="csrf" value="{{csrf}}">
      <button class="lnk" style="color:#da3633">Salir</button>
    </form>
  </div>
</div>
<div class="box">
  {%if msg%}
  <div class="al {{'aok' if tok else 'aer'}}">{{msg}}</div>
  {%endif%}
  <div class="ruta">{{ruta}}</div>
  {%if padre%}
  <a href="/files?r={{padre}}" class="volver">
    ⬆ Subir</a>
  {%endif%}
  <input class="q" id="q"
         placeholder="🔍 Buscar..." oninput="q()">
  <div class="lista">
    {%for i in items%}
    <div class="fi">
      <span class="ico">{{i.ico}}</span>
      <div class="inf">
        {%if i.dir%}
        <a class="fl" href="/files?r={{i.re}}">
          <div class="fn">{{i.n}}</div></a>
        {%else%}
        <div class="fn">{{i.n}}</div>
        {%endif%}
        <div class="fm">{{i.sz}} · {{i.dt}}</div>
      </div>
      <div class="acts">
        {%if not i.dir%}
        <a class="dl"
           href="/dl?r={{i.re}}"
           title="Descargar">⬇</a>
        {%endif%}
        {%if i.dir%}
        <form method="POST" action="/ocultar"
              onsubmit="return confirmar_ocultar(this)">
          <input type="hidden" name="csrf" value="{{csrf}}">
          <input type="hidden" name="r" value="{{i.re}}">
          <button class="hi" type="submit"
                  data-nombre="{{i.n|e}}"
                  title="Ocultar carpeta">👁</button>
        </form>
        {%endif%}
        <form method="POST" action="/eliminar"
              onsubmit="return confirmar_borrar(this)">
          <input type="hidden" name="csrf" value="{{csrf}}">
          <input type="hidden" name="r" value="{{i.re}}">
          <button class="rm" type="submit"
                  data-nombre="{{i.n|e}}"
                  title="Eliminar">🗑</button>
        </form>
      </div>
    </div>
    {%else%}
    <div style="padding:24px;text-align:center;
                color:#484f58">Carpeta vacía</div>
    {%endfor%}
  </div>
</div></body></html>
"""


# ──────────────────────────────────────────────
# SERVIDOR FLASK — COMPLETO Y FUNCIONAL
# ──────────────────────────────────────────────
class Servidor:
    def __init__(self, datos):
        self.datos     = datos
        self.flask     = None
        self.activo    = False
        self.puerto    = PUERTO_WEB
        self.ip        = ip_local()
        self.intentos  = 0
        self.blq_hasta = 0
        self.HOME      = os.path.expanduser("~")
        self.HOME_REAL = os.path.realpath(self.HOME)

    def iniciar(self):
        if not FLASK_OK:
            return False
        self.flask = Flask(__name__)
        secret_web = self.datos.get_secret_web()
        if not secret_web:
            secret_web = secrets.token_hex(32)
            self.datos.set_secret_web(secret_web)
        self.flask.secret_key = secret_web
        self.flask.config.update(
            SESSION_COOKIE_HTTPONLY=True,
            SESSION_COOKIE_SAMESITE="Lax"
        )
        import logging
        logging.getLogger("werkzeug")\
               .setLevel(logging.ERROR)
        self._rutas()
        self.activo = True
        threading.Thread(
            target=self._run,
            daemon=True).start()
        return True

    def _run(self):
        try:
            self.flask.run(
                host="0.0.0.0",
                port=self.puerto,
                debug=False,
                use_reloader=False)
        except Exception:
            self.activo = False

    def _auth(self):
        return session.get("auth") is True

    def _csrf(self):
        t = session.get("csrf")
        if not t:
            t = secrets.token_urlsafe(24)
            session["csrf"] = t
        return t

    def _check_csrf(self):
        tok_form = request.form.get("csrf","")
        tok_sess = session.get("csrf","")
        return bool(tok_form and tok_sess and hmac.compare_digest(
            tok_form, tok_sess))

    def _real(self, ruta):
        return os.path.realpath(os.path.normpath(ruta))

    def _en_home(self, ruta):
        try:
            rr = os.path.normcase(self._real(ruta))
            hh = os.path.normcase(self.HOME_REAL)
            return os.path.commonpath([rr, hh]) == hh
        except Exception:
            return False

    def _redir(self, base, msg=None, t="ok", extra=None):
        q = {}
        if msg is not None:
            q["msg"] = msg
        if t is not None:
            q["t"] = t
        if isinstance(extra, dict):
            for k, v in extra.items():
                if v is not None and v != "":
                    q[k] = v
        if not q:
            return redirect(base)
        return redirect(base + "?" + urllib.parse.urlencode(q))

    def _rutas(self):
        F = self.flask
        D = self.datos
        S = self

        # ── Login ─────────────────────────────
        @F.route("/", methods=["GET","POST"])
        def login():
            bl=False; rest=0; err=None
            ahora=time.time()
            if ahora < S.blq_hasta:
                bl=True
                rest=int(S.blq_hasta-ahora)
            if request.method=="POST" and not bl:
                if not S._check_csrf():
                    err="Sesión inválida. Recarga la página."
                else:
                    k=request.form.get("k","")
                    if ok_hash(k, D.get_maestra()):
                        session.clear()
                        session["auth"]=True
                        session["csrf"]=secrets.token_urlsafe(24)
                        S.intentos=0
                        D.log("WEB+",
                              request.remote_addr)
                        return redirect("/panel")
                    S.intentos += 1
                    D.log("WEB!",
                          f"#{S.intentos} "
                          f"{request.remote_addr}")
                    if S.intentos >= 3:
                        rnd=S.intentos//3
                        esp=min(60*(2**(rnd-1)),3600)
                        S.blq_hasta=ahora+esp
                        err=f"Bloqueado {esp}s."
                    else:
                        err=(f"Incorrecta. "
                             f"{3-S.intentos%3} rest.")
            return render_template_string(
                HTML_LOGIN,
                bloqueado=bl,rest=rest,error=err,
                csrf=S._csrf())

        # ── Panel ─────────────────────────────
        @F.route("/panel")
        def panel():
            if not S._auth():
                return redirect("/")
            cs = [
                {**c,
                 "ok":os.path.exists(c["ruta_nueva"])}
                for c in D.get_carpetas()
            ]
            logs = list(reversed(D.get_logs()[-20:]))
            ru   = urllib.parse.quote(S.HOME_REAL,safe="")
            return render_template_string(
                HTML_PANEL,
                inet=hay_internet(),
                wifi=wifi_actual(),
                ip=S.ip,
                blq=ESTADO.bloqueada,
                nc=len(cs),
                carpetas=cs,
                logs=logs,
                ru=ru,
                tunel_url=ESTADO.tunel_url,
                msg=request.args.get("msg",""),
                tok=(request.args.get("t","ok")=="ok"),
                hora=datetime.now().strftime("%H:%M:%S"),
                csrf=S._csrf()
            )

        # ── Bloquear ──────────────────────────
        @F.route("/lock", methods=["POST"])
        def lock():
            if not S._auth():
                return redirect("/")
            if not S._check_csrf():
                return S._redir("/panel",
                               "Token inválido",
                               "err")
            if ESTADO.ventana_ref and ESTADO.root_ref:
                if encolar_accion_ui("lock"):
                    D.log("WEB🔒APP", request.remote_addr)
                    return S._redir("/panel",
                                   "Pantalla bloqueada (modo app)",
                                   "ok")
            ok, err = bloquear_sesion_windows()
            if ok:
                ESTADO.bloqueada = True
                D.log("WEB🔒SYS", request.remote_addr)
                return S._redir("/panel",
                               "Sesión Windows bloqueada",
                               "ok")
            D.log("WEB🔒ERR", f"{request.remote_addr} {err}")
            return S._redir("/panel",
                           f"No se pudo bloquear: {err}",
                           "err")

        # ── Desbloquear ───────────────────────
        @F.route("/unlock", methods=["POST"])
        def unlock():
            if not S._auth():
                return redirect("/")
            if not S._check_csrf():
                return S._redir("/panel",
                               "Token inválido",
                               "err")
            if ESTADO.ventana_ref and ESTADO.root_ref:
                encolar_accion_ui("unlock")
                D.log("WEB🔓APP", request.remote_addr)
                return S._redir("/panel",
                               "Pantalla desbloqueada (modo app)",
                               "ok")
            else:
                ESTADO.bloqueada = False
                D.log("WEB🔓INFO", request.remote_addr)
                return S._redir(
                    "/panel",
                    "Si usaste bloqueo de Windows, desbloquea "
                    "con usuario local en la PC",
                    "err")

        # ── Ocultar desde panel (formulario) ──
        @F.route("/ocultar_web", methods=["POST"])
        def ocultar_web():
            if not S._auth():
                return redirect("/")
            if not S._check_csrf():
                return S._redir("/panel",
                               "Token inválido",
                               "err")
            ruta = request.form.get("ruta","").strip()
            ruta = S._real(ruta)
            if not S._en_home(ruta):
                return S._redir("/panel",
                               "Ruta fuera de HOME",
                               "err")
            ok, msg = op_ocultar_carpeta(D, ruta)
            if ok:
                return S._redir("/panel",
                               f"Oculta: {msg}",
                               "ok")
            return S._redir("/panel",
                           f"Error: {msg}",
                           "err")

        # ── Ocultar desde explorador ──────────
        @F.route("/ocultar", methods=["POST"])
        def ocultar_exp():
            if not S._auth():
                return redirect("/")
            if not S._check_csrf():
                return S._redir("/panel",
                               "Token inválido",
                               "err")
            ruta = S._real(urllib.parse.unquote(
                request.form.get("r","")))
            if not S._en_home(ruta):
                return S._redir("/panel",
                               "Denegado",
                               "err")
            ok, msg = op_ocultar_carpeta(D, ruta)
            padre = os.path.dirname(ruta)
            if ok:
                return S._redir(
                    "/files",
                    f"Oculta: {msg}",
                    "ok",
                    {"r": padre})
            return S._redir(
                "/files",
                f"Error: {msg}",
                "err",
                {"r": padre})

        # ── Recuperar carpeta ─────────────────
        @F.route("/recover", methods=["POST"])
        def recover():
            if not S._auth():
                return redirect("/")
            if not S._check_csrf():
                return S._redir("/panel",
                               "Token inválido",
                               "err")
            rid = request.form.get("rid","").strip()
            if rid:
                ok, res = op_recuperar_carpeta_id(D, rid)
            else:
                try:
                    i = int(request.form.get("i","-1"))
                except Exception:
                    i = -1
                ok, res = op_recuperar_carpeta(D, i)
            if ok:
                return S._redir(
                    "/panel",
                    f"Recuperada: {os.path.basename(res)}",
                    "ok")
            return S._redir("/panel",
                           f"Error: {res}",
                           "err")

        # ── Explorador de archivos ────────────
        @F.route("/files")
        def files():
            if not S._auth():
                return redirect("/")
            r = S._real(urllib.parse.unquote(
                request.args.get("r", S.HOME_REAL)))
            if not S._en_home(r):
                return S._redir("/panel",
                               "Denegado",
                               "err")
            if not os.path.exists(r):
                return S._redir("/panel",
                               "No existe",
                               "err")
            items = []
            try:
                lista = sorted(
                    os.listdir(r),
                    key=lambda x:(
                        not os.path.isdir(
                            os.path.join(r,x)),
                        x.lower()))
                for n in lista:
                    rc = S._real(os.path.join(r, n))
                    if not S._en_home(rc):
                        continue
                    d  = os.path.isdir(rc)
                    try:
                        sz = ("Carpeta" if d
                              else formato_tam(
                                  os.path.getsize(rc)))
                        dt = datetime.fromtimestamp(
                            os.path.getmtime(rc)
                        ).strftime("%d/%m/%y %H:%M")
                    except Exception:
                        sz=dt="?"
                    ext=os.path.splitext(n)[1].lower()
                    ico=(
                        "📁" if d else
                        "🖼" if ext in{
                            ".jpg",".jpeg",".png",
                            ".gif",".bmp"} else
                        "🎬" if ext in{
                            ".mp4",".avi",".mkv"} else
                        "🎵" if ext in{
                            ".mp3",".wav",".flac"} else
                        "📄" if ext==".pdf" else
                        "📝" if ext in{
                            ".doc",".docx"} else
                        "📊" if ext in{
                            ".xls",".xlsx",".csv"} else
                        "📦" if ext in{
                            ".zip",".rar",".7z"} else
                        "⚙" if ext in{
                            ".exe",".bat"} else "📃")
                    items.append({
                        "n":   n,
                        "re":  urllib.parse.quote(
                            rc,safe=""),
                        "dir": d,
                        "sz":  sz,
                        "dt":  dt,
                        "ico": ico
                    })
            except Exception:
                pass
            pa = os.path.dirname(r)
            padre = (
                urllib.parse.quote(pa,safe="")
                if S._en_home(pa)
                and pa!=r else "")
            return render_template_string(
                HTML_FILES,
                ruta=r,
                items=items,
                padre=padre,
                msg=request.args.get("msg",""),
                tok=(request.args.get("t","ok")=="ok"),
                csrf=S._csrf())

        # ── Descargar ─────────────────────────
        @F.route("/dl")
        def dl():
            if not S._auth():
                return redirect("/")
            r = S._real(urllib.parse.unquote(
                request.args.get("r","")))
            if not S._en_home(r):
                return S._redir("/panel",
                               "Denegado",
                               "err")
            if not os.path.isfile(r):
                return S._redir("/panel",
                               "No existe",
                               "err")
            D.log("DL", os.path.basename(r))
            try:
                return send_file(
                    r, as_attachment=True)
            except Exception as e:
                return S._redir("/panel",
                               f"Error DL: {e}",
                               "err")

        # ── Eliminar ──────────────────────────
        @F.route("/eliminar", methods=["POST"])
        def eliminar():
            if not S._auth():
                return redirect("/")
            if not S._check_csrf():
                return S._redir("/panel",
                               "Token inválido",
                               "err")
            r = S._real(urllib.parse.unquote(
                request.form.get("r","")))
            if not S._en_home(r):
                return S._redir("/panel",
                               "Denegado",
                               "err")
            padre_enc = os.path.dirname(r)
            ok, msg = op_eliminar_archivo(r)
            D.log("DEL" if ok else "DEL_ERR",
                  os.path.basename(r))
            return S._redir(
                "/files",
                "Eliminado" if ok else msg,
                "ok" if ok else "err",
                {"r": padre_enc})

        # ── Logout ────────────────────────────
        @F.route("/out", methods=["POST"])
        def out():
            if not S._check_csrf():
                return redirect("/")
            session.clear()
            D.log("WEB-", request.remote_addr)
            return redirect("/")


# ──────────────────────────────────────────────
# FUNCIONES DE BLOQUEO GLOBAL
# Llamadas desde el servidor Flask via root.after
# ──────────────────────────────────────────────
def _hacer_bloqueo():
    """Ejecuta el bloqueo en el hilo de tkinter."""
    if ESTADO.ventana_ref:
        try:
            ESTADO.ventana_ref._bloquear_real()
        except Exception:
            pass

def _hacer_desbloqueo():
    """Ejecuta el desbloqueo en el hilo de tkinter."""
    if ESTADO.ventana_ref:
        try:
            ESTADO.ventana_ref._desbloquear_real()
        except Exception:
            pass

def encolar_accion_ui(accion):
    try:
        ESTADO.ui_queue.put_nowait(accion)
        return True
    except Exception:
        return False


# ──────────────────────────────────────────────
# MONITOR
# ──────────────────────────────────────────────
class Monitor:
    def __init__(self, datos, tunel):
        self.datos       = datos
        self.tunel       = tunel
        self.ultima_url  = ""
        self._last_retry = 0
        self._internet_previo = True
        self._fallback_enviado = False
        self._fallback_next = 0
        self._url_notificada = ""
        self._url_fallida = ""
        self._url_retry_next = 0
        threading.Thread(
            target=self._loop,
            daemon=True).start()

    def notificar_url_tunel(self, url):
        if not url:
            return
        self.ultima_url = url
        self._fallback_enviado = False
        self._fallback_next = 0
        cfg = self.datos.get_email()
        if cfg.get("envio") and cfg.get("password"):
            self._intentar_email_url(url, cfg)

    def _loop(self):
        time.sleep(20)
        while True:
            try:
                self._ciclo()
            except Exception:
                pass
            time.sleep(90)

    def _ciclo(self):
        internet_ahora = hay_internet()

        # Detectar restauración de internet tras corte
        if internet_ahora and not self._internet_previo:
            self.datos.log(
                "TUNEL",
                "Internet restaurado — reconectando túnel...")
            self._url_notificada = ""
            self._url_fallida    = ""
            self._url_retry_next = 0
            self._fallback_enviado = False
            self._fallback_next    = 0
            self._last_retry = 0
        self._internet_previo = internet_ahora

        if not internet_ahora:
            return

        url = self.tunel.url_publica \
              if self.tunel else ""
        cfg = self.datos.get_email()
        if url:
            if url != self.ultima_url:
                self.ultima_url = url
            if cfg.get("envio") and cfg.get("password"):
                self._intentar_email_url(url, cfg)
            self._fallback_enviado = False
            self._fallback_next = 0
        elif not url:
            if cfg.get("envio") and cfg.get("password"):
                ahora = time.time()
                if (not self._fallback_enviado
                        and ahora >= self._fallback_next):
                    ok = self._email_fallback_local(cfg)
                    if ok:
                        self._fallback_enviado = True
                    else:
                        self._fallback_next = ahora + 300
        # Reiniciar túnel caído — reintentos infinitos cada 3 minutos
        if (self.tunel
                and not self.tunel.activo
                and not self.tunel._iniciando
                and internet_ahora):
            ahora = time.time()
            if ahora - self._last_retry >= 180:
                self._last_retry = ahora
                self.datos.log(
                    "TUNEL",
                    "Reconectando túnel (reintento automático)...")
                self.tunel.reiniciar(
                    self._cb_url)

    def _cb_url(self, url):
        self.notificar_url_tunel(url)

    def _intentar_email_url(self, url, cfg):
        if not url:
            return False
        if url == self._url_notificada:
            return True
        ahora = time.time()
        if (url == self._url_fallida
                and ahora < self._url_retry_next):
            return False
        ok = self._email(url, cfg)
        if ok:
            self._url_notificada = url
            self._url_fallida = ""
            self._url_retry_next = 0
        else:
            self._url_fallida = url
            self._url_retry_next = ahora + 120
        return ok

    def _email(self, url, cfg):
        ip   = ip_local()
        wifi = wifi_actual()
        hora = datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S")
        body = f"""
<html><body style="margin:0;padding:20px;
background:#0d1117;font-family:Arial;color:#f0f6fc">
<div style="max-width:380px;margin:0 auto;
background:#161b22;border:1px solid #30363d;
border-radius:12px;padding:22px">
<h2 style="color:#58a6ff;text-align:center;
margin-bottom:14px">🔐 SecureVault Pro</h2>
<div style="background:#1f6feb22;
border:2px solid #1f6feb66;border-radius:8px;
padding:12px;margin-bottom:12px;text-align:center">
<div style="color:#8b949e;font-size:11px;
margin-bottom:5px">🌍 URL DE ACCESO REMOTO</div>
<div style="color:#58a6ff;font-weight:700;
font-size:15px;word-break:break-all">{url}</div>
</div>
<div style="background:#0d1117;border-radius:7px;
padding:10px;margin-bottom:12px">
<p style="margin:4px 0;font-size:12px">
<span style="color:#8b949e">💻 IP local:</span>
<strong style="color:#3fb950">{ip}:{PUERTO_WEB}</strong></p>
<p style="margin:4px 0;font-size:12px">
<span style="color:#8b949e">📶 WiFi:</span>
<strong style="color:#3fb950">
{wifi or 'Desconocida'}</strong></p>
<p style="margin:4px 0;font-size:12px">
<span style="color:#8b949e">🕐 Hora:</span>
<strong style="color:#3fb950">{hora}</strong></p>
</div>
<div style="text-align:center">
<a href="{url}"
style="display:inline-block;background:#1f6feb;
color:#fff;padding:11px 18px;border-radius:6px;
text-decoration:none;font-weight:700;
font-size:13px;margin:3px">
🌍 Abrir Panel</a>
<a href="http://{ip}:{PUERTO_WEB}"
style="display:inline-block;background:#238636;
color:#fff;padding:11px 18px;border-radius:6px;
text-decoration:none;font-weight:700;
font-size:13px;margin:3px">
🏠 Red Local</a>
</div>
</div></body></html>"""
        ok = enviar_email(
            cfg,"🔐 SecureVault — PC en línea",body)
        self.datos.log(
            "EMAIL"+"✅" if ok else "EMAIL❌",
            url[:35]+"...")
        return ok

    def _email_fallback_local(self, cfg):
        ip   = ip_local()
        wifi = wifi_actual()
        hora = datetime.now().strftime(
            "%Y-%m-%d %H:%M:%S")
        local_url = f"http://{ip}:{PUERTO_WEB}"
        body = f"""
<html><body style="margin:0;padding:20px;
background:#0d1117;font-family:Arial;color:#f0f6fc">
<div style="max-width:420px;margin:0 auto;
background:#161b22;border:1px solid #30363d;
border-radius:12px;padding:22px">
<h2 style="color:#58a6ff;text-align:center;
margin-bottom:14px">🔐 SecureVault Pro</h2>
<div style="background:#f0883e22;
border:2px solid #f0883e66;border-radius:8px;
padding:12px;margin-bottom:12px;text-align:center">
<div style="color:#8b949e;font-size:11px;
margin-bottom:5px">⚠ MODO FALLBACK (sin túnel público)</div>
<div style="color:#f0883e;font-weight:700;
font-size:14px;word-break:break-all">Usa la red local</div>
</div>
<div style="background:#0d1117;border-radius:7px;
padding:10px;margin-bottom:12px">
<p style="margin:4px 0;font-size:12px">
<span style="color:#8b949e">💻 IP local:</span>
<strong style="color:#3fb950">{ip}:{PUERTO_WEB}</strong></p>
<p style="margin:4px 0;font-size:12px">
<span style="color:#8b949e">📶 WiFi:</span>
<strong style="color:#3fb950">{wifi or 'Desconocida'}</strong></p>
<p style="margin:4px 0;font-size:12px">
<span style="color:#8b949e">🕐 Hora:</span>
<strong style="color:#3fb950">{hora}</strong></p>
</div>
<div style="text-align:center">
<a href="{local_url}"
style="display:inline-block;background:#238636;
color:#fff;padding:11px 18px;border-radius:6px;
text-decoration:none;font-weight:700;
font-size:13px;margin:3px">
🏠 Abrir Panel en red local</a>
</div>
</div></body></html>"""
        ok = enviar_email(
            cfg,
            "🔐 SecureVault — Fallback local (sin túnel)",
            body)
        self.datos.log(
            "EMAIL_FALLBACK✅" if ok else "EMAIL_FALLBACK❌",
            local_url)
        return ok


# ──────────────────────────────────────────────
# VENTANA PRINCIPAL
# ──────────────────────────────────────────────
class Ventana:
    def __init__(self, datos, srv, tunel):
        self.datos    = datos
        self.srv      = srv
        self.tunel    = tunel
        self.root     = None
        self.v_blq    = None
        self.blq_int  = 0
        self.blq_hasta= 0

    def abrir(self):
        """Abre o trae al frente la ventana."""
        if self.root:
            try:
                if self.root.winfo_exists():
                    self.root.deiconify()
                    self.root.lift()
                    self.root.focus_force()
                    return
            except Exception:
                pass

        self.root = tk.Tk()
        ESTADO.root_ref    = self.root
        ESTADO.ventana_ref = self

        self.root.title("SecureVault Pro")
        self.root.geometry("460x700")
        self.root.resizable(False,False)
        self.root.configure(bg="#0d1117")

        sw=self.root.winfo_screenwidth()
        sh=self.root.winfo_screenheight()
        self.root.geometry(
            f"460x700+{(sw-460)//2}+{(sh-700)//2}")

        # CRÍTICO: cerrar ventana NO mata el proceso
        self.root.protocol(
            "WM_DELETE_WINDOW",
            self._cerrar_ventana)

        self._ui()
        self._hilo_ui()
        self._procesar_acciones_ui()
        self._vigilar_signal()
        if ESTADO.bloqueada:
            self.root.after(100, self._bloquear_real)
        self.root.lift()
        self.root.focus_force()
        self.root.mainloop()

        # Al salir limpiar referencias
        ESTADO.root_ref    = None
        ESTADO.ventana_ref = None
        self.root = None

    def _cerrar_ventana(self):
        """
        Oculta la ventana PERO el proceso
        y todos los servicios siguen activos.
        """
        try:
            self.root.withdraw()
        except Exception:
            pass

    def _ui(self):
        # Header
        hdr = tk.Frame(self.root,bg="#161b22",
                       height=54)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        tk.Label(
            hdr,text="🔐 SecureVault Pro",
            font=("Segoe UI",15,"bold"),
            fg="#f0f6fc",bg="#161b22"
        ).pack(side="left",padx=14,pady=10)
        self.lbl_net = tk.Label(
            hdr,text="●",
            font=("Segoe UI",10),
            bg="#161b22",fg="#484f58")
        self.lbl_net.pack(side="right",padx=14)

        # Aviso importante
        tk.Frame(
            self.root,
            bg="#16243a",
            highlightbackground="#2a4f7d",
            highlightthickness=1
        ).pack(fill="x")
        tk.Label(
            self.root,
            text="ℹ  Cerrar esta ventana NO "
                 "detiene el programa — "
                 "los servicios siguen activos",
            font=("Segoe UI",8),
            fg="#58a6ff",bg="#16243a",
            pady=3
        ).pack(fill="x")

        c = tk.Frame(self.root,bg="#0d1117")
        c.pack(fill="both",expand=True,
               padx=16,pady=6)

        # Card estado
        sc = tk.Frame(c,bg="#161b22",
                      highlightbackground="#30363d",
                      highlightthickness=1)
        sc.pack(fill="x",pady=4)

        srv_ok = self.srv and self.srv.activo
        tk.Label(
            sc,
            text=("✅ Servidor local activo"
                  if srv_ok else "⏳ Iniciando..."),
            font=("Segoe UI",9),
            fg="#3fb950" if srv_ok else "#8b949e",
            bg="#161b22",padx=12,pady=3
        ).pack(anchor="w")

        url_t = ESTADO.tunel_url
        self.lbl_tunel = tk.Label(
            sc,
            text=(f"🌍 {url_t}"
                  if url_t
                  else "⏳ Obteniendo URL pública..."),
            font=("Segoe UI",8),
            fg="#58a6ff" if url_t else "#f0883e",
            bg="#161b22",padx=12,pady=2,
            wraplength=420,justify="left")
        self.lbl_tunel.pack(anchor="w")

        self.lbl_local = tk.Label(
            sc,
            text=f"🏠 http://{ip_local()}:{PUERTO_WEB}",
            font=("Consolas",9),
            fg="#484f58",bg="#161b22",
            padx=12,pady=2)
        self.lbl_local.pack(anchor="w")

        self.lbl_wifi = tk.Label(
            sc,text="",
            font=("Segoe UI",8),
            fg="#8b949e",bg="#161b22",
            padx=12,pady=2)
        self.lbl_wifi.pack(anchor="w")

        def sec(t):
            fr=tk.Frame(c,bg="#0d1117")
            fr.pack(fill="x",pady=4)
            tk.Label(fr,text=t,
                     font=("Segoe UI",9,"bold"),
                     fg="#8b949e",bg="#0d1117"
                     ).pack(anchor="w")
            tk.Frame(fr,bg="#21262d",
                     height=1).pack(fill="x",pady=1)

        def btn(t,color,cmd):
            b=tk.Button(
                c,text=t,
                font=("Segoe UI",10),
                bg=color,fg="#f0f6fc",
                activebackground="#484f58",
                activeforeground="white",
                relief="flat",cursor="hand2",
                anchor="w",padx=10,command=cmd)
            b.pack(fill="x",pady=2,ipady=6)
            return b

        sec("🔒 Protección")
        btn("  🔒 Bloquear Pantalla",
            "#7f1d1d",self._bloquear_real)

        sec("📦 Almacén Seguro")
        btn("  👁 Ocultar Carpeta",
            "#14532d",self._ocultar_ui)
        btn("  📤 Recuperar Carpeta",
            "#1e3a5f",self._recuperar_ui)
        btn("  📋 Ver Protegidos",
            "#374151",self._ver_protegidos)

        sec("⚙ Configuración")
        btn("  🔑 Cambiar Contraseñas",
            "#374151",self._cambiar_claves)
        btn("  📧 Configurar Email",
            "#374151",self._config_email)
        self.btn_auto = btn(
            "  🚀 Autostart: "+(
                "✅" if check_autostart() else "❌"),
            "#374151",self._toggle_auto)
        btn("  📜 Ver Registro",
            "#374151",self._ver_log)
        btn("  🩺 Diagnóstico",
            "#374151",self._diagnostico)

        # Botón cerrar explícito
        tk.Button(
            c,
            text="✕  Minimizar a segundo plano",
            font=("Segoe UI",9),
            bg="#21262d",fg="#8b949e",
            activebackground="#30363d",
            relief="flat",cursor="hand2",
            command=self._cerrar_ventana
        ).pack(fill="x",pady=5,ipady=4)

    def _hilo_ui(self):
        def loop():
            try:
                if not self.root or not self.root.winfo_exists():
                    return
                ok = hay_internet()
                wf = wifi_actual()
                ip = ip_local()
                self.lbl_net.config(
                    text="● "+(
                        "En línea" if ok
                        else "Sin internet"),
                    fg="#3fb950" if ok
                    else "#da3633")
                self.lbl_wifi.config(
                    text=f"📶 {wf}"
                    if wf else "📵 Sin WiFi")
                self.lbl_local.config(
                    text=f"🏠 http://{ip}:{PUERTO_WEB}")
                if ESTADO.tunel_url:
                    self.lbl_tunel.config(
                        text=f"🌍 {ESTADO.tunel_url}",
                        fg="#58a6ff",
                        font=("Consolas",8,"bold"))
            except Exception:
                return
            self.root.after(12000, loop)
        self.root.after(0, loop)

    def _procesar_acciones_ui(self):
        try:
            if not self.root or not self.root.winfo_exists():
                return
            while True:
                try:
                    accion = ESTADO.ui_queue.get_nowait()
                except queue.Empty:
                    break
                if accion == "lock":
                    self._bloquear_real()
                elif accion == "unlock":
                    self._desbloquear_real()
                elif accion == "show":
                    self.root.deiconify()
                    self.root.lift()
                    self.root.focus_force()
        except Exception:
            pass
        self.root.after(200, self._procesar_acciones_ui)

    def _vigilar_signal(self):
        try:
            if not self.root or not self.root.winfo_exists():
                return
            if os.path.exists(ARCHIVO_SIGNAL):
                try:
                    os.remove(ARCHIVO_SIGNAL)
                except Exception:
                    pass
                self.root.deiconify()
                self.root.lift()
                self.root.focus_force()
        except Exception:
            return
        self.root.after(1000, self._vigilar_signal)

    # ── Bloqueo ────────────────────────────────
    def _bloquear_real(self):
        try:
            if self.v_blq and self.v_blq.winfo_exists():
                return
        except Exception:
            pass
        ESTADO.bloqueada = True
        self.blq_int     = 0
        self.root.withdraw()
        self.datos.log("🔒","Bloqueada")

        v = tk.Toplevel()
        self.v_blq = v
        v.attributes("-fullscreen",True)
        v.attributes("-topmost",True)
        v.configure(bg="#010409")
        v.protocol("WM_DELETE_WINDOW",lambda:None)
        for t in ["<Alt-F4>","<Alt-Tab>",
                  "<Alt-Escape>","<Escape>"]:
            try:
                v.bind(t,lambda e:"break")
            except Exception:
                pass

        f = tk.Frame(v,bg="#010409")
        f.place(relx=.5,rely=.5,anchor="center")
        tk.Label(f,text="🔐",
                 font=("Segoe UI",48),
                 bg="#010409").pack(pady=5)
        tk.Label(f,text="Sesión bloqueada",
                 font=("Segoe UI",22,"bold"),
                 fg="#58a6ff",bg="#010409").pack()
        tk.Label(f,text="Contraseña maestra",
                 font=("Segoe UI",9),
                 fg="#8b949e",bg="#010409").pack(pady=7)
        self.e_blq = tk.Entry(
            f,show="*",font=("Segoe UI",14),
            justify="center",width=22,
            bg="#161b22",fg="white",
            insertbackground="white",relief="flat")
        self.e_blq.pack(pady=6,ipady=6)
        self.e_blq.bind("<Return>",
                        lambda _:self._check_blq())
        tk.Button(
            f,text="Desbloquear",
            font=("Segoe UI",11,"bold"),
            bg="#238636",fg="white",
            relief="flat",cursor="hand2",
            width=16,command=self._check_blq
        ).pack(pady=8,ipady=4)
        self.lbl_blq = tk.Label(
            f,text="",font=("Segoe UI",9),
            fg="#da3633",bg="#010409")
        self.lbl_blq.pack(pady=3)

        v.after(300,self._foco)
        self.root.after(1000,self._guardian)
        self._tope()

    def _desbloquear_real(self):
        ESTADO.bloqueada = False
        self.datos.log("🔓","Desbloqueada")
        try:
            self.v_blq.destroy()
        except Exception:
            pass
        self.v_blq = None
        try:
            self.root.deiconify()
            self.root.lift()
        except Exception:
            pass

    def _foco(self):
        try:
            if self.v_blq and self.v_blq.winfo_exists():
                self.v_blq.focus_force()
                self.e_blq.focus_set()
        except Exception:
            pass

    def _tope(self):
        if not ESTADO.bloqueada:
            return
        try:
            if self.v_blq and self.v_blq.winfo_exists():
                self.v_blq.lift()
                self.v_blq.attributes("-topmost",True)
        except Exception:
            pass
        try:
            self.root.after(500,self._tope)
        except Exception:
            pass

    def _guardian(self):
        if not ESTADO.bloqueada:
            return
        try:
            if not self.v_blq or not self.v_blq.winfo_exists():
                self._bloquear_real()
                return
        except Exception:
            self._bloquear_real()
            return
        self.root.after(1000,self._guardian)

    def _check_blq(self):
        ahora = time.time()
        if ahora < self.blq_hasta:
            self.lbl_blq.config(
                text=f"⏳ Espera "
                     f"{int(self.blq_hasta-ahora)}s")
            self.e_blq.delete(0,tk.END)
            return
        clave = self.e_blq.get()
        if not clave:
            return
        if ok_hash(clave,self.datos.get_maestra()):
            self._desbloquear_real()
        else:
            self.blq_int += 1
            if self.blq_int >= 3:
                esp=min(30*(2**(self.blq_int//3-1)),1800)
                self.blq_hasta=ahora+esp
                self.lbl_blq.config(
                    text=f"⛔ Bloqueado {esp}s",
                    fg="#f0883e")
            else:
                self.lbl_blq.config(
                    text=f"❌ ({3-self.blq_int%3} rest.)",
                    fg="#da3633")
            self.e_blq.delete(0,tk.END)
            self.v_blq.after(200,self._foco)

    # ── Carpetas ───────────────────────────────
    def _ocultar_ui(self):
        ruta = filedialog.askdirectory(
            title="Carpeta a proteger")
        if not ruta:
            return
        ok, msg = op_ocultar_carpeta(
            self.datos, ruta)
        if ok:
            messagebox.showinfo(
                "✅ Protegida",
                f"Carpeta oculta:\n{msg}")
        else:
            messagebox.showerror("Error", msg)

    def _recuperar_ui(self):
        cs = self.datos.get_carpetas()
        if not cs:
            messagebox.showinfo(
                "","Sin carpetas protegidas.")
            return
        v = tk.Toplevel(self.root)
        v.title("Recuperar")
        v.geometry("480x360")
        v.configure(bg="#0d1117")
        v.resizable(False,False)
        tk.Label(v,text="Carpetas Protegidas",
                 font=("Segoe UI",12,"bold"),
                 fg="#f0f6fc",
                 bg="#0d1117").pack(pady=10)
        fl=tk.Frame(v,bg="#0d1117")
        fl.pack(fill="both",expand=True,padx=15)
        sb=tk.Scrollbar(fl)
        sb.pack(side="right",fill="y")
        lb=tk.Listbox(
            fl,font=("Segoe UI",10),
            bg="#161b22",fg="#f0f6fc",
            selectbackground="#1f6feb",
            relief="flat",highlightthickness=0,
            yscrollcommand=sb.set,height=10)
        lb.pack(fill="both",expand=True)
        sb.config(command=lb.yview)
        ids = []
        for c in cs:
            rid = c.get("id","") if isinstance(c,dict) else ""
            ids.append(rid)
            ok="✅" if os.path.exists(
                c["ruta_nueva"]) else "❌"
            lb.insert(
                tk.END,
                f"  {ok}  {c['original']}"
                f"  →  {c['nombre_nuevo']}")

        def ejecutar():
            sel=lb.curselection()
            if not sel:
                messagebox.showwarning(
                    "","Selecciona uno.",parent=v)
                return
            rid = ids[sel[0]] if sel[0] < len(ids) else ""
            if rid:
                ok,res=op_recuperar_carpeta_id(
                    self.datos,rid)
            else:
                ok,res=op_recuperar_carpeta(
                    self.datos,sel[0])
            if ok:
                messagebox.showinfo(
                    "✅",f"Recuperada:\n{res}",
                    parent=v)
                v.destroy()
            else:
                messagebox.showerror(
                    "Error",res,parent=v)

        tk.Button(
            v,text="Recuperar",
            font=("Segoe UI",11,"bold"),
            bg="#238636",fg="white",
            relief="flat",cursor="hand2",
            command=ejecutar
        ).pack(pady=10,ipady=5)

    def _ver_protegidos(self):
        cs=self.datos.get_carpetas()
        if not cs:
            messagebox.showinfo("","Sin elementos.")
            return
        txt=f"PROTEGIDOS: {len(cs)}\n{'='*44}\n\n"
        for i,c in enumerate(cs,1):
            ok="✅" if os.path.exists(
                c["ruta_nueva"]) else "❌"
            txt+=(f"[{i}] {c['original']}\n"
                  f"    → {c['nombre_nuevo']}\n"
                  f"    {c['fecha']}  {ok}\n\n")
        self._txt("Protegidos",txt)

    def _cambiar_claves(self):
        v=tk.Toplevel(self.root)
        v.title("Cambiar Contraseñas")
        v.geometry("370x400")
        v.configure(bg="#0d1117")
        v.resizable(False,False)
        f=tk.Frame(v,bg="#0d1117")
        f.place(relx=.5,rely=.5,anchor="center")
        tk.Label(f,text="🔑 Cambiar Contraseñas",
                 font=("Segoe UI",12,"bold"),
                 fg="#f0f6fc",bg="#0d1117").pack(pady=7)
        campos={}
        defs=[
            ("Maestra actual:","ma"),
            ("Nueva maestra:","mn"),
            ("Confirmar maestra:","mc"),
            ("App actual:","aa"),
            ("Nueva app:","an"),
            ("Confirmar app:","ac"),
        ]
        for lbl,key in defs:
            tk.Label(f,text=lbl,fg="#8b949e",
                     bg="#0d1117",
                     font=("Segoe UI",9)).pack(anchor="w")
            e=tk.Entry(f,show="*",
                       font=("Segoe UI",10),width=26,
                       bg="#161b22",fg="white",
                       insertbackground="white",
                       relief="flat")
            e.pack(pady=2,ipady=3)
            campos[key]=e

        def guardar():
            ma=campos["ma"].get()
            mn=campos["mn"].get()
            mc=campos["mc"].get()
            aa=campos["aa"].get()
            an=campos["an"].get()
            ac=campos["ac"].get()
            if ma and mn:
                if not ok_hash(ma,
                        self.datos.get_maestra()):
                    messagebox.showerror(
                        "","Maestra incorrecta.",parent=v)
                    return
                if mn!=mc or len(mn)<4:
                    messagebox.showerror(
                        "","Nueva inválida.",parent=v)
                    return
                self.datos.set_maestra(hacer_hash(mn))
            if aa and an:
                if not ok_hash(aa,
                        self.datos.get_app()):
                    messagebox.showerror(
                        "","App incorrecta.",parent=v)
                    return
                if an!=ac or len(an)<4:
                    messagebox.showerror(
                        "","Nueva inválida.",parent=v)
                    return
                self.datos.set_app(hacer_hash(an))
            self.datos.log("CLAVE","OK")
            messagebox.showinfo("✅","Listo.",parent=v)
            v.destroy()

        tk.Button(
            f,text="Actualizar",
            font=("Segoe UI",11,"bold"),
            bg="#238636",fg="white",
            relief="flat",cursor="hand2",
            width=18,command=guardar
        ).pack(pady=8,ipady=4)

    def _config_email(self):
        v=tk.Toplevel(self.root)
        v.title("Email")
        v.geometry("370x280")
        v.configure(bg="#0d1117")
        v.resizable(False,False)
        f=tk.Frame(v,bg="#0d1117")
        f.place(relx=.5,rely=.5,anchor="center")
        tk.Label(f,text="📧 Notificaciones",
                 font=("Segoe UI",12,"bold"),
                 fg="#f0f6fc",bg="#0d1117").pack(pady=7)
        cfg=self.datos.get_email()
        campos={}
        defs=[
            ("Gmail de envío:","gm",
             cfg.get("envio",""),False),
            ("Contraseña App Google:","gp",
             cfg.get("password",""),True),
            ("Email destino:","dest",
             cfg.get("destino",EMAIL_DESTINO),False),
        ]
        for lbl,key,val,oculto in defs:
            tk.Label(f,text=lbl,fg="#8b949e",
                     bg="#0d1117",
                     font=("Segoe UI",9)).pack(anchor="w")
            e=tk.Entry(f,show="*" if oculto else "",
                       font=("Segoe UI",10),width=28,
                       bg="#161b22",fg="white",
                       insertbackground="white",
                       relief="flat")
            e.pack(pady=2,ipady=4)
            e.insert(0,val)
            campos[key]=e

        def guardar():
            ok = self.datos.set_email({
                "envio":campos["gm"].get().strip(),
                "password":campos["gp"].get().strip(),
                "destino":campos["dest"].get().strip()
            })
            if not ok:
                messagebox.showerror(
                    "Error",
                    "No se pudo guardar el secreto de email.",
                    parent=v)
                return
            messagebox.showinfo("✅","Guardado.",parent=v)
            v.destroy()

        def probar():
            cfg2={
                "envio":campos["gm"].get().strip(),
                "password":campos["gp"].get().strip(),
                "destino":campos["dest"].get().strip()
            }
            ok=enviar_email(
                cfg2,"🔐 SecureVault — Prueba",
                f"<h3 style='color:#58a6ff'>"
                f"✅ Funciona</h3>"
                f"<p>URL: {ESTADO.tunel_url}</p>"
                f"<p>IP: {ip_local()}</p>")
            if ok:
                messagebox.showinfo(
                    "✅","Email enviado.",parent=v)
            else:
                messagebox.showerror(
                    "Error",
                    "No se envió.\n"
                    "Verifica Gmail + "
                    "Contraseña de App Google.",parent=v)

        bf=tk.Frame(f,bg="#0d1117")
        bf.pack(pady=8,fill="x")
        tk.Button(
            bf,text="Guardar",
            font=("Segoe UI",10,"bold"),
            bg="#238636",fg="white",relief="flat",
            cursor="hand2",command=guardar
        ).pack(side="left",padx=3,ipady=4,
               expand=True,fill="x")
        tk.Button(
            bf,text="Probar",
            font=("Segoe UI",10,"bold"),
            bg="#1f6feb",fg="white",relief="flat",
            cursor="hand2",command=probar
        ).pack(side="right",padx=3,ipady=4,
               expand=True,fill="x")

    def _toggle_auto(self):
        if AUTOSTART_FORZADO:
            asegurar_autostart(self.datos)
            self.btn_auto.config(
                text="  🚀 Autostart: ✅")
            messagebox.showinfo(
                "Autostart",
                "Autostart forzado: siempre activo.")
            return
        on=check_autostart()
        set_autostart(not on)
        nuevo=check_autostart()
        txt="✅" if nuevo else "❌"
        self.btn_auto.config(
            text=f"  🚀 Autostart: {txt}")
        messagebox.showinfo(
            "Autostart",f"Inicio automático: {txt}")

    def _ver_log(self):
        logs=self.datos.get_logs()
        if not logs:
            messagebox.showinfo("","Sin actividad.")
            return
        txt=f"ACTIVIDAD ({len(logs)})\n{'='*44}\n\n"
        for r in reversed(logs[-80:]):
            txt+=(f"[{r['t']}]  "
                  f"{r['f']}  {r['d']}\n")
        self._txt("Actividad",txt)

    def _diagnostico(self):
        srv_ok=self.srv and self.srv.activo
        url_t=ESTADO.tunel_url
        txt ="DIAGNÓSTICO\n"+"="*44+"\n\n"
        txt+=f"Internet  : {'✅' if hay_internet() else '❌'}\n"
        txt+=f"WiFi      : {wifi_actual() or 'No'}\n"
        txt+=f"IP local  : {ip_local()}\n"
        txt+=f"Flask     : {'✅' if FLASK_OK else '❌ pip install flask'}\n"
        txt+=f"Servidor  : {'✅' if srv_ok else '❌'}\n"
        txt+=f"Túnel     : {'✅' if url_t else '⏳ Esperando...'}\n"
        if url_t:
            txt+=f"URL       : {url_t}\n"
        txt+=f"Autostart : {'✅' if check_autostart() else '❌'}\n"
        cfg=self.datos.get_email()
        txt+=f"Email     : {cfg.get('envio','❌')}\n"
        cs=self.datos.get_carpetas()
        txt+=f"Carpetas  : {len(cs)}\n"
        txt+=f"Datos     : {BASE_DIR}\n"
        self._txt("Diagnóstico",txt)

    def _txt(self,titulo,contenido):
        v=tk.Toplevel(self.root)
        v.title(titulo)
        v.geometry("560x420")
        v.configure(bg="#0d1117")
        f=tk.Frame(v,bg="#0d1117")
        f.pack(fill="both",expand=True,padx=10,pady=10)
        sb=tk.Scrollbar(f)
        sb.pack(side="right",fill="y")
        tw=tk.Text(f,font=("Consolas",10),
                   bg="#0d1117",fg="#7ee787",
                   wrap="word",relief="flat",
                   yscrollcommand=sb.set)
        tw.pack(fill="both",expand=True)
        sb.config(command=tw.yview)
        tw.insert("1.0",contenido)
        tw.config(state="disabled")


# ──────────────────────────────────────────────
# SETUP PRIMERA VEZ
# ──────────────────────────────────────────────
def setup_primera_vez(datos):
    v=tk.Tk()
    v.title("SecureVault — Configuración")
    v.geometry("400x440")
    v.configure(bg="#0d1117")
    v.resizable(False,False)
    sw=v.winfo_screenwidth()
    sh=v.winfo_screenheight()
    v.geometry(f"400x440+{(sw-400)//2}+{(sh-440)//2}")
    completado=[False]

    f=tk.Frame(v,bg="#0d1117")
    f.place(relx=.5,rely=.5,anchor="center")
    tk.Label(f,text="🔐 Configuración Inicial",
             font=("Segoe UI",13,"bold"),
             fg="#58a6ff",bg="#0d1117").pack(pady=6)
    tk.Label(f,text="Solo aparece UNA vez",
             font=("Segoe UI",8),
             fg="#484f58",bg="#0d1117").pack()

    campos={}
    defs=[
        ("Contraseña para bloquear pantalla:","p1",True),
        ("Confirmar contraseña pantalla:","p2",True),
        ("Contraseña para abrir la app:","p3",True),
        ("Confirmar contraseña app:","p4",True),
        ("Tu Gmail (recibirás la URL):","gm",False),
        ("Contraseña de App de Google:","gp",True),
    ]
    for lbl,key,oculto in defs:
        tk.Label(f,text=lbl,fg="#8b949e",
                 bg="#0d1117",
                 font=("Segoe UI",8)).pack(anchor="w")
        e=tk.Entry(f,show="*" if oculto else "",
                   font=("Segoe UI",10),width=32,
                   bg="#161b22",fg="white",
                   insertbackground="white",
                   relief="flat")
        e.pack(pady=1,ipady=3)
        campos[key]=e

    tk.Label(
        f,
        text="Gmail→Seguridad→Contraseñas de aplicaciones",
        fg="#484f58",bg="#0d1117",
        font=("Segoe UI",7)).pack(pady=2)

    def guardar():
        p1=campos["p1"].get(); p2=campos["p2"].get()
        p3=campos["p3"].get(); p4=campos["p4"].get()
        gm=campos["gm"].get().strip()
        gp=campos["gp"].get().strip()
        if len(p1)<4:
            messagebox.showwarning(
                "","Mínimo 4 caracteres.",parent=v)
            return
        if p1!=p2:
            messagebox.showerror(
                "","Pantalla no coincide.",parent=v)
            return
        if len(p3)<4:
            messagebox.showwarning(
                "","App mínimo 4 chars.",parent=v)
            return
        if p3!=p4:
            messagebox.showerror(
                "","App no coincide.",parent=v)
            return
        datos.set_maestra(hacer_hash(p1))
        datos.set_app(hacer_hash(p3))
        if gm:
            ok_email = datos.set_email({
                "envio":gm,"password":gp,
                "destino":gm})
            if not ok_email:
                messagebox.showwarning(
                    "Aviso",
                    "No se pudo guardar la clave de email.",
                    parent=v)
        set_autostart(True)
        datos.log("SETUP","OK")
        completado[0]=True
        messagebox.showinfo(
            "✅ Listo",
            "Configuración guardada.\n\n"
            "De ahora en adelante:\n"
            "• Inicia con Windows (invisible)\n"
            "• Envía URL al Gmail\n"
            "• Doble clic → pide contraseña\n"
            "• Cerrar ventana NO detiene nada",
            parent=v)
        v.destroy()

    tk.Button(
        f,text="Guardar y Continuar",
        font=("Segoe UI",11,"bold"),
        bg="#238636",fg="white",
        relief="flat",cursor="hand2",
        width=22,command=guardar
    ).pack(pady=8,ipady=5)
    v.protocol("WM_DELETE_WINDOW",
               lambda:sys.exit(0))
    v.mainloop()
    return completado[0]


# ──────────────────────────────────────────────
# PANTALLA DE ACCESO
# ──────────────────────────────────────────────
class AccesoApp:
    def __init__(self, datos, on_ok):
        self.datos=datos; self.on_ok=on_ok
        self.intentos=0; self.blq=0
        self._ok=False
        self.v=tk.Tk()
        self.v.title("SecureVault Pro")
        self.v.geometry("340x280")
        self.v.configure(bg="#0d1117")
        self.v.resizable(False,False)
        sw=self.v.winfo_screenwidth()
        sh=self.v.winfo_screenheight()
        self.v.geometry(
            f"340x280+{(sw-340)//2}+{(sh-280)//2}")
        self.v.protocol("WM_DELETE_WINDOW",
                        self.v.destroy)
        self.v.lift(); self.v.focus_force()
        self._ui()
        self.v.mainloop()
        if self._ok:
            self.on_ok()

    def _ui(self):
        f=tk.Frame(self.v,bg="#0d1117")
        f.place(relx=.5,rely=.5,anchor="center")
        tk.Label(f,text="🔐",
                 font=("Segoe UI",34),
                 bg="#0d1117").pack(pady=4)
        tk.Label(f,text="SecureVault Pro",
                 font=("Segoe UI",15,"bold"),
                 fg="#f0f6fc",bg="#0d1117").pack()
        tk.Label(f,text="Contraseña de la app",
                 font=("Segoe UI",9),
                 fg="#484f58",bg="#0d1117").pack(pady=4)
        self.e=tk.Entry(
            f,show="*",font=("Segoe UI",13),
            justify="center",width=20,
            bg="#161b22",fg="white",
            insertbackground="white",relief="flat")
        self.e.pack(pady=7,ipady=6)
        self.e.bind("<Return>",lambda _:self._check())
        self.e.focus_set()
        tk.Button(
            f,text="Entrar",
            font=("Segoe UI",11,"bold"),
            bg="#238636",fg="white",
            relief="flat",cursor="hand2",
            width=15,command=self._check
        ).pack(pady=6,ipady=4)
        self.msg=tk.Label(
            f,text="",font=("Segoe UI",9),
            fg="#da3633",bg="#0d1117")
        self.msg.pack(pady=2)

    def _check(self):
        ahora=time.time()
        if ahora<self.blq:
            self.msg.config(
                text=f"Espera {int(self.blq-ahora)}s…",
                fg="#f0883e")
            self.e.delete(0,tk.END); return
        clave=self.e.get()
        if not clave: return
        h=self.datos.get_app()
        if not h or ok_hash(clave,h):
            self._ok=True
            self.v.destroy()
            return
        else:
            self.intentos+=1
            if self.intentos>=3:
                esp=min(30*(2**(self.intentos//3-1)),600)
                self.blq=ahora+esp
                self.msg.config(
                    text=f"Bloqueado {esp}s",fg="#f0883e")
            else:
                self.msg.config(
                    text=f"Incorrecta "
                         f"({3-self.intentos%3} rest.)",
                    fg="#da3633")
            self.e.delete(0,tk.END)


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
def main():
    ocultar_consola()
    datos = Datos()

    # Primera vez
    if not datos.get_maestra():
        ok = setup_primera_vez(datos)
        if not ok:
            sys.exit(0)
        if getattr(sys,"frozen",False):
            subprocess.Popen(
                [sys.executable,"--silencioso"],
                creationflags=0x08000000)
        else:
            subprocess.Popen(
                [sys.executable,
                 os.path.abspath(__file__),
                 "--silencioso"],
                creationflags=0x08000000)
        sys.exit(0)

    # Reforzar inicio con Windows
    if AUTOSTART_FORZADO:
        asegurar_autostart(datos)

    # Instancia única
    if not manejar_instancia():
        sys.exit(0)

    # Iniciar servicios
    srv   = Servidor(datos)
    srv_ok = srv.iniciar()
    tunel = Tunel(PUERTO_WEB, datos) if srv_ok else None
    monitor = Monitor(datos, tunel) if tunel else None

    # Vigila que el autostart siga activo
    watchdog_autostart(datos)

    # Ventana reutilizable
    ventana = Ventana(datos, srv, tunel)

    def cb_tunel(url):
        ESTADO.tunel_url = url
        datos.log("TUNEL_OK", url)
        if monitor:
            try:
                monitor.notificar_url_tunel(url)
            except Exception:
                pass

    if tunel:
        tunel.iniciar(callback=cb_tunel)
    else:
        datos.log(
            "SERVIDOR_ERR",
            "Flask no disponible; túnel desactivado")

    def mostrar_con_acceso():
        if datos.get_app():
            AccesoApp(datos, ventana.abrir)
        else:
            ventana.abrir()

    def bucle_signal():
        while True:
            try:
                time.sleep(1)
                if os.path.exists(ARCHIVO_SIGNAL):
                    try:
                        os.remove(ARCHIVO_SIGNAL)
                    except Exception:
                        pass
                    mostrar_con_acceso()
            except Exception as e:
                datos.log("SIGNAL_ERR", str(e))

    if MODO_SILENCIOSO:
        datos.log("INICIO","Modo silencioso")
        bucle_signal()
    else:
        datos.log("INICIO","Modo normal")
        mostrar_con_acceso()
        bucle_signal()


if __name__ == "__main__":
    main()
