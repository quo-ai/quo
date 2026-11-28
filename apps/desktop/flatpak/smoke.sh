#!/usr/bin/env bash
# Installs a Quo Flatpak bundle and runs its smoke test (--smoke) as an ordinary user under a virtual display, in a
# throwaway container of Flathub's CI image: in .github/workflows/flatpak.yml, or with podman (README.md here). Inside
# Flatpak the smoke test also runs a command on the computer and checks that one ignoring signals is stopped.
# `smoke.sh <bundle.flatpak>`. It changes the container (a user, a kernel setting), so it runs nowhere else.
set -euo pipefail
bundle=${1:?Usage: smoke.sh <bundle.flatpak>}
if [[ $(id -u) -ne 0 || ! ( -f /.dockerenv || -f /run/.containerenv ) ]]; then
  echo "smoke.sh runs only as root in a throwaway container." >&2
  exit 1
fi

flatpak install -y --noninteractive --system --bundle "$bundle"

# Ubuntu's kernel keeps ordinary users from making the namespaces Flatpak's sandbox needs unless told otherwise.
restrict=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [[ -w $restrict ]]; then echo 0 >"$restrict"; fi

# As an ordinary user, as people run it: Electron won't start as root with its sandbox on. The image has no useradd
# or su, so the user is written in and Python drops to it.
uid=1001
home=/var/lib/quo-smoke
if ! grep -q '^quo-smoke:' /etc/passwd; then
  echo "quo-smoke:x:$uid:$uid:quo-smoke:$home:/bin/sh" >>/etc/passwd
  echo "quo-smoke:x:$uid:" >>/etc/group
fi
install -d -o "$uid" -g "$uid" -m 700 "$home" "/run/user/$uid"

# Two Flatpak services D-Bus starts when asked: the session helper (flatpak-spawn --host reaches the computer through
# it) and the Flatpak portal (Electron's sandbox, zypak, starts the page's processes through it). Computers with Flatpak
# installed tell D-Bus where they are; this image has both programs but not those files, so they're written for the user.
services=$home/.local/share/dbus-1/services
install -d -o "$uid" -g "$uid" "$home/.local" "$home/.local/share" "$home/.local/share/dbus-1" "$services"
for service in org.freedesktop.Flatpak:flatpak-session-helper org.freedesktop.portal.Flatpak:flatpak-portal; do
  name=${service%%:*}
  program=
  for dir in /usr/libexec /app/libexec; do
    if [[ -x $dir/${service#*:} ]]; then program=$dir/${service#*:}; break; fi
  done
  [[ -n $program ]] || { echo "${service#*:} isn't in this image." >&2; exit 1; }
  printf '[D-BUS Service]\nName=%s\nExec=%s\n' "$name" "$program" >"$services/$name.service"
done

exec python3 -I - "$uid" "$home" <<'PY'
import os, sys
uid, home = int(sys.argv[1]), sys.argv[2]
os.setgroups([])
os.setgid(uid)
os.setuid(uid)
os.chdir(home)
# The image's own settings (its tools find their libraries through LD_LIBRARY_PATH), as this user.
env = {**os.environ, 'HOME': home, 'USER': 'quo-smoke', 'LOGNAME': 'quo-smoke', 'XDG_RUNTIME_DIR': f'/run/user/{uid}', 'LANG': 'C.UTF-8'}
command = ['xvfb-run', '-a', 'flatpak', 'run', '--env=QUO_EXPECT_ENGINE=1', 'computer.quo.Quo', '--smoke']
os.execvpe('dbus-run-session', ['dbus-run-session', '--', *command], env)
PY
