#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# chrome-sandbox 必须 root:root + 4755。
#
# electron-builder 自带模板用 `unshare --user true` 探测内核是否支持用户命名空间,
# 但安装脚本本身是以 root 运行的 —— root 下这个探测必然成功,于是它错误地走了
# "命名空间可用"分支,把 chrome-sandbox 设成 0755。
# 而真实用户可能因为 AppArmor 限制用不了非特权用户命名空间(Ubuntu 24.04 默认
# kernel.apparmor_restrict_unprivileged_userns=1),此时 Chromium 会回退到 SUID
# helper,发现权限不是 4755 就直接 FATAL 中止:
#   The SUID sandbox helper binary was found, but is not configured correctly.
#
# 所以这里不再做那个无意义的探测,无条件设成 4755 —— 无论命名空间是否可用,
# 这个配置都能正常启动。
chown root:root '/opt/${sanitizedProductName}/chrome-sandbox' 2>/dev/null || true
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
