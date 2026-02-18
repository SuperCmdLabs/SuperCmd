/**
 * src/native/speech-recognizer.cs
 *
 * Windows speech recognizer using System.Speech (built into .NET Framework 4.x,
 * available on every Windows 10/11 machine — no API key, works offline).
 *
 * Usage:  speech-recognizer.exe [lang]
 *   lang  BCP-47 language tag, e.g. en-US (default).
 *
 * Stdout protocol (one JSON object per line, same as the macOS Swift binary):
 *   {"ready":true}                                – recognizer is listening
 *   {"transcript":"text","isFinal":true|false}    – speech result
 *   {"error":"message"}                           – fatal error then exit
 *
 * The process runs until killed by the parent (node sends SIGTERM / TerminateProcess).
 */

using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Threading;

class SpeechRecognizerProgram
{
    static string Escape(string s)
    {
        return (s ?? string.Empty)
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r");
    }

    static void Emit(string json)
    {
        Console.WriteLine(json);
        Console.Out.Flush();
    }

    static void Main(string[] args)
    {
        string lang = args.Length > 0 ? args[0].Trim() : "en-US";

        // Try the requested culture, fall back to en-US, then system default.
        SpeechRecognitionEngine engine = null;
        string[] candidates = { lang, "en-US", string.Empty };
        foreach (string id in candidates)
        {
            try
            {
                engine = id.Length == 0
                    ? new SpeechRecognitionEngine()
                    : new SpeechRecognitionEngine(new CultureInfo(id));
                break;
            }
            catch { /* try next */ }
        }

        if (engine == null)
        {
            Emit("{\"error\":\"No speech recognition engine is available on this system.\"}");
            return;
        }

        try
        {
            engine.SetInputToDefaultAudioDevice();
        }
        catch (Exception ex)
        {
            Emit("{\"error\":\"" + Escape(ex.Message) + "\"}");
            engine.Dispose();
            return;
        }

        engine.LoadGrammar(new DictationGrammar());

        // Interim / hypothesis — sent while the user is still speaking.
        engine.SpeechHypothesized += (sender, e) =>
        {
            Emit("{\"transcript\":\"" + Escape(e.Result.Text) + "\",\"isFinal\":false}");
        };

        // Final result — sent when the engine has committed to a result.
        engine.SpeechRecognized += (sender, e) =>
        {
            Emit("{\"transcript\":\"" + Escape(e.Result.Text) + "\",\"isFinal\":true}");
        };

        // Low-confidence results are silently ignored.
        engine.SpeechRecognitionRejected += (sender, e) => { };

        engine.RecognizeAsync(RecognizeMode.Multiple);

        // Signal the parent that we are ready.
        Emit("{\"ready\":true}");

        // Block the main thread forever — the SAPI engine delivers events on
        // background threads.  The parent kills this process via TerminateProcess
        // when it wants to stop recognition.
        Thread.Sleep(Timeout.Infinite);

        engine.Dispose();
    }
}
