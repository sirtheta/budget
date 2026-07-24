import packageJson from "@/package.json";

const REPO_URL = "https://github.com/sirtheta/budget";

export function AppFooter() {
  return (
    <footer className="border-t py-3">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-muted-foreground">
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">
          Haushaltsbudget v{packageJson.version}
        </a>
        {" · © "}
        {new Date().getFullYear()}
      </div>
    </footer>
  );
}
