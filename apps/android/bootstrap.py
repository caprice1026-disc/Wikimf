"""Install pinned build tooling in this app only; existing global SDK/JDK are untouched."""
from pathlib import Path
import hashlib
import os
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / ".tooling"
TOOLS.mkdir(exist_ok=True)


def download(name, url, checksum_url=None):
    target = TOOLS / name
    if not target.exists():
        print(f"Downloading {name}", flush=True)
        with urllib.request.urlopen(url) as response, target.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
    if checksum_url:
        expected = urllib.request.urlopen(checksum_url).read().decode().split()[0]
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if expected != actual:
            raise RuntimeError(f"Checksum mismatch for {name}")
    return target


jdk_url = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.16%2B8/OpenJDK17U-jdk_x64_windows_hotspot_17.0.16_8.zip"
gradle_url = "https://services.gradle.org/distributions/gradle-8.9-bin.zip"
for archive, url, directory, marker, checksum in [
    ("jdk.zip", jdk_url, TOOLS / "jdk", "jdk-17.0.16+8/bin/java.exe", jdk_url + ".sha256.txt"),
    ("gradle.zip", gradle_url, TOOLS, "gradle-8.9/bin/gradle.bat", gradle_url + ".sha256"),
    ("sdk-tools.zip", "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip", TOOLS / "sdk", "cmdline-tools/latest/bin/sdkmanager.bat", None),
]:
    if not (directory / marker).exists():
        with zipfile.ZipFile(download(archive, url, checksum)) as bundle:
            bundle.extractall(directory)
        if archive == "sdk-tools.zip":
            extracted = directory / "cmdline-tools"
            staged = directory / "cmdline-tools-staged"
            extracted.rename(staged)
            extracted.mkdir()
            staged.rename(extracted / "latest")

env = os.environ.copy()
env["JAVA_HOME"] = str(TOOLS / "jdk/jdk-17.0.16+8")
env["ANDROID_USER_HOME"] = str(TOOLS / "android-user")
Path(env["ANDROID_USER_HOME"]).mkdir(exist_ok=True)
sdk = TOOLS / "sdk"
# sdkmanager presents Android SDK license terms. Accept them to install the requested build environment.
subprocess.run([str(sdk / "cmdline-tools/latest/bin/sdkmanager.bat"), f"--sdk_root={sdk}", "platforms;android-35", "build-tools;35.0.0", "platform-tools"], input="y\n" * 100, text=True, env=env, check=True)
print("Build with: powershell -File apps/android/build.ps1")
