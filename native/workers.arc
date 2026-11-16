; Platform adapters are loaded after the unmodified official libraries.
(def ensure-dir (path) (worker-mkdir path))
(def shash (text) (worker-sha1 text))

; Keep original SHA1 account records. Also accept salted records written by
; the earlier version of this port so existing accounts can still log in.
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

(def worker-next-delay ()
  (when pending-bgthreads*
    (max 1 (apply min
             (map (fn ((id f sec))
                    (- (+ (worker-bg-last* id (seconds)) sec) (seconds)))
                  pending-bgthreads*)))))

(def worker-start ()
  (ensure-srvdirs)
  (map ensure-dir (list newsdir* storydir* votedir* profdir*))
  (load-userinfo)
  (load-items)
  ; srv.arc sleeps before each background function's first invocation.
  (each (id f sec) pending-bgthreads* (= (worker-bg-last* id) (seconds))))

; These counters were incremented by the socket accept loop in srv.arc.
(def worker-count-request (ip)
  (++ requests*)
  (++ (requests/ip* ip 0)))
