; Platform adapters are loaded after the unmodified official libraries.
(def ensure-dir (path) (worker-mkdir path))
(def unique-id () (sym (worker-random)))
(def shash (text) (worker-sha1 text))

; Workers does not expose process memory usage. Keep the useful admin stats.
(def admin-bar (user elapsed whence)
  (when (admin user)
    (br2)
    (w/bars
      (pr (len items*) "/" maxid* " loaded")
      (pr elapsed " msec")
      (link "settings" "newsadmin")
      (hook 'admin-bar user whence))))

; Preserve Arc's account/cookie flows while replacing the openssl subprocess
; with Workers Web Crypto. New passwords are salted; old SHA1 data is readable.
(def set-pw (user pw)
  (= (hpasswords* user) (and pw (worker-password-hash pw)))
  (save-table hpasswords* hpwfile*))

(def good-login (user pw ip)
  (let record (list (seconds) ip user)
    (if (and user pw (worker-password-matches pw (hpasswords* user)))
        (do (unless (user->cookie* user) (cook-user user))
            (enq-limit record good-logins*)
            user)
        (do (enq-limit record bad-logins*) nil))))

(= worker-bg-last* (table))
(def worker-tick ()
  (each (id f sec) pending-bgthreads*
    (when (>= (- (seconds) (worker-bg-last* id 0)) sec)
      (= (worker-bg-last* id) (seconds))
      (errsafe (f))))
  (harvest-fnids))

(def worker-start ()
  (ensure-srvdirs)
  (map ensure-dir (list newsdir* storydir* votedir* profdir*))
  (load-userinfo)
  (load-items))

; These counters were incremented by the socket accept loop in srv.arc.
(def worker-count-request (ip)
  (++ requests*)
  (++ (requests/ip* ip 0)))
