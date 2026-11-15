// The former Sites deployment is a redirect only. Its D1 binding is retained
// for recovery, but no second watchlist can accumulate after the cutover.
export default {fetch(request:Request){const url=new URL(request.url);return Response.redirect(`https://lacey.january.ie${url.pathname}${url.search}`,308);}};
