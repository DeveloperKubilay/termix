#include <jni.h>
#include <node.h>
#include <android/log.h>
#include <atomic>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <unistd.h>

namespace {
std::atomic<bool> started{false};

class UtfString {
public:
    UtfString(JNIEnv* env, jstring value) : env_(env), value_(value), chars_(env->GetStringUTFChars(value, nullptr)) {}
    ~UtfString() { if (chars_) env_->ReleaseStringUTFChars(value_, chars_); }
    const char* get() const { return chars_; }
private:
    JNIEnv* env_;
    jstring value_;
    const char* chars_;
};
}

extern "C" JNIEXPORT jint JNICALL
Java_com_termix_android_preview_RuntimeController_nativeStart(
        JNIEnv* env, jclass, jstring entryValue, jstring dataValue, jstring keyValue,
        jstring socketValue, jstring tempValue) {
    if (started.exchange(true)) return -2;
    UtfString entry(env, entryValue), data(env, dataValue), key(env, keyValue),
            socket(env, socketValue), temp(env, tempValue);
    if (!entry.get() || !data.get() || !key.get() || !socket.get() || !temp.get()) return -3;
    if (setenv("TERMIX_PLATFORM", "android", 1) != 0 ||
        setenv("TERMIX_DATA_ROOT", data.get(), 1) != 0 ||
        setenv("TERMIX_PORTABLE_KEY", key.get(), 1) != 0 ||
        setenv("TERMIX_ANDROID_SOCKET", socket.get(), 1) != 0 ||
        setenv("TERMIX_NODE_ENTRY", entry.get(), 1) != 0 ||
        setenv("TMPDIR", temp.get(), 1) != 0 ||
        setenv("HOME", data.get(), 1) != 0) return -4;
    const std::string entryPath(entry.get());
    const auto slash = entryPath.find_last_of('/');
    if (slash == std::string::npos || chdir(entryPath.substr(0, slash).c_str()) != 0) return -5;
    // node::Start requires writable argv in one contiguous allocation.
    const char executable[] = "termix-node";
    std::vector<char> arguments(sizeof(executable) + entryPath.size() + 1);
    std::memcpy(arguments.data(), executable, sizeof(executable));
    std::memcpy(arguments.data() + sizeof(executable), entryPath.c_str(), entryPath.size() + 1);
    char* argv[] = {arguments.data(), arguments.data() + sizeof(executable), nullptr};
    __android_log_print(ANDROID_LOG_INFO, "TermixRuntime", "Starting embedded Node (local 4 KB feasibility preview)");
    const int result = node::Start(2, argv);
    __android_log_print(ANDROID_LOG_ERROR, "TermixRuntime", "Embedded Node exited (%d); process restart required", result);
    return result;
}
