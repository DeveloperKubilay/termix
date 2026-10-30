cmake_minimum_required(VERSION 3.22.1)
project(termix_android LANGUAGES CXX)

set(RUNTIME_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../runtime")
if(NOT EXISTS "${RUNTIME_ROOT}/bin/${ANDROID_ABI}/libnode.so")
    message(FATAL_ERROR "Missing runtime/bin/${ANDROID_ABI}/libnode.so. Install the pinned local feasibility runtime.")
endif()
if(NOT EXISTS "${RUNTIME_ROOT}/include/node/node.h")
    message(FATAL_ERROR "Missing runtime/include/node/node.h.")
endif()

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION "${RUNTIME_ROOT}/bin/${ANDROID_ABI}/libnode.so")
add_library(termix-runtime SHARED runtime.cpp)
target_include_directories(termix-runtime PRIVATE "${RUNTIME_ROOT}/include/node")
target_link_libraries(termix-runtime PRIVATE node log)
# This aligns OUR JNI library. The official prebuilt libnode is still a 4 KB feasibility-only binary.
target_link_options(termix-runtime PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")
