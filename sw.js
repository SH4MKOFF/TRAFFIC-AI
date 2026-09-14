const CACHE = "ghost-vision-v1";

const FILES = [
  "./",
  "./index.html",
  "./style.css?v=10",
  "./app.js?v=10",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {

  event.waitUntil(

    caches
      .open(CACHE)
      .then(cache => cache.addAll(FILES))
      .then(() => self.skipWaiting())
      .catch(() => {})

  );

});


self.addEventListener("activate", event => {

  event.waitUntil(
    self.clients.claim()
  );

});


self.addEventListener("fetch", event => {

  if(event.request.method !== "GET")
    return;

  event.respondWith(

    caches
      .match(event.request)
      .then(cached => {

        if(cached)
          return cached;

        return fetch(event.request)
          .then(response => {

            const copy=
              response.clone();

            caches
              .open(CACHE)
              .then(cache =>
                cache.put(
                  event.request,
                  copy
                )
              )
              .catch(()=>{});

            return response;

          })
          .catch(()=>cached);

      })

  );

});