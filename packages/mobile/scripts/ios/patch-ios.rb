# 在 CI 上 `cap add ios` 之后运行,把键盘工具条移除代码接入生成的 Xcode 工程。
# 用法(在 packages/mobile 目录): ruby scripts/ios/patch-ios.rb
# 依赖 xcodeproj gem(GitHub macOS runner 随 CocoaPods 预装)。
require "xcodeproj"
require "fileutils"

mobile_dir = File.expand_path(File.join(__dir__, "..", ".."))
ios_app_dir = File.join(mobile_dir, "ios", "App", "App")
project_path = File.join(mobile_dir, "ios", "App", "App.xcodeproj")

abort("ios project not found, run `cap add ios` first") unless Dir.exist?(ios_app_dir)

# 1. 拷入 Swift 源文件
sources = %w[KeyboardAccessoryRemover.swift MainViewController.swift]
sources.each do |name|
  FileUtils.cp(File.join(__dir__, name), File.join(ios_app_dir, name))
end

# 2. 挂进 Xcode 工程的 App target
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == "App" }
abort("App target not found") unless target
app_group = project.main_group.find_subpath("App", false) || project.main_group
sources.each do |name|
  next if app_group.files.any? { |f| f.path == name }
  file_ref = app_group.new_reference(name)
  target.add_file_references([file_ref])
end
project.save

# 3. Main.storyboard: CAPBridgeViewController -> MainViewController
storyboard = File.join(ios_app_dir, "Base.lproj", "Main.storyboard")
xml = File.read(storyboard)
patched = xml
  .gsub('customClass="CAPBridgeViewController"', 'customClass="MainViewController"')
  .gsub('customModule="Capacitor"', 'customModule="App"')
if patched == xml && !xml.include?("MainViewController")
  abort("storyboard patch did not match; template layout changed?")
end
File.write(storyboard, patched)

puts "iOS project patched: keyboard accessory bar removal wired in."
