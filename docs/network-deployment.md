# Beta network deployment

Showtime's built-in server uses HTTP and WebSocket without TLS. Pairing tokens, saved device credentials, chat, and show data travel unencrypted. A token in the link fragment keeps it out of the initial navigation request, but redeeming the link sends it to the server.

Only enable connections on a private network controlled by the show team. Do not use venue guest Wi-Fi, public Wi-Fi, port forwarding, or expose port 8585 to the internet. Anyone able to inspect traffic on that network may capture reusable device credentials. Remove affected devices under Connections if the network or a device is compromised.

For networks outside that policy, use an administrator-managed HTTPS reverse proxy with a certificate trusted by every device. It must proxy both HTTP and WebSocket upgrades to Showtime, preserve the pairing fragment, and prevent clients from bypassing TLS by reaching port 8585 directly. Share links using that HTTPS origin. Automatic mDNS and IP links continue to point to the built-in HTTP server.

Browsers only permit service workers and offline installation on secure origins, including HTTPS and loopback development origins. Normal HTTP LAN connections support the online app but cannot cache the offline app shell. A browser without secure-origin support must stay connected to the show computer.

Pairing supports private IPv4, IPv4 link-local networks without DHCP, and unscoped IPv6 addresses through the desktop server's dual-stack listener. Scoped IPv6 link-local literals are excluded because browser connection URLs do not consistently support interface zone identifiers. IPv6-only networks need a routable IPv6 address, such as a unique local address, or working mDNS.
