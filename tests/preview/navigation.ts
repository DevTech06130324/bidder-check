export const usePathname = () => window.location.pathname;
export const useRouter = () => ({
  refresh() {},
  push(url: string) {
    window.location.href = url;
  },
});
