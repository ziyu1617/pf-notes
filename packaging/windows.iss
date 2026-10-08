#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\SmartNotes"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist\releases"
#endif

[Setup]
AppId={{032E0826-7562-4839-87B8-056D02C65DF0}
AppName=Smart Notes
AppVersion={#AppVersion}
AppPublisher=ziyu1617
AppPublisherURL=https://github.com/ziyu1617/pf-notes
DefaultDirName={localappdata}\Programs\Smart Notes
DefaultGroupName=Smart Notes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.14393
OutputDir={#OutputDir}
OutputBaseFilename=SmartNotes-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\SmartNotes.exe
CloseApplications=yes

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Smart Notes"; Filename: "{app}\SmartNotes.exe"
Name: "{autodesktop}\Smart Notes"; Filename: "{app}\SmartNotes.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\SmartNotes.exe"; Description: "Launch Smart Notes"; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2: Boolean;
var Version: String;
begin
  Result := RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0');
  if not Result then
    Result := RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)
      and (Version <> '') and (Version <> '0.0.0.0');
end;

function InitializeSetup: Boolean;
var ErrorCode: Integer;
begin
  Result := HasWebView2;
  if not Result then begin
    MsgBox('Smart Notes requires Microsoft Edge WebView2 Runtime. Install the Evergreen Runtime from Microsoft, then run this installer again. Your existing notes are unchanged.', mbInformation, MB_OK);
    if not WizardSilent then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;
