import Foundation
import Security
SecKeychainSetUserInteractionAllowed(false)
var keychain: SecKeychain?
let result = SecKeychainCopyDefault(&keychain)
var resultPath = ""
if let keychain = keychain { var size:UInt32=4096;var bytes=[CChar](repeating:0,count:4096);let status=SecKeychainGetPath(keychain,&size,&bytes);if status==0{resultPath=String(cString:bytes)} }
print("status=\(result) defaultPath=\(resultPath) home=\(NSHomeDirectory())")
