import React, { useRef, useState, useEffect } from 'react';
import { View, Button, Alert, StyleSheet, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { captureRef } from 'react-native-view-shot';
import PDFLib, { PDFDocument, PDFPage } from 'react-native-pdf-lib';

export default function App() {
  const cameraRef = useRef(null);
  const [hasPermission, setHasPermission] = useState(null);
  const [capturedUri, setCapturedUri] = useState(null);
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const takePicture = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync();
      setCapturedUri(photo.uri);
      setIsPreview(true);
    }
  };

  const createPDF = async () => {
    if (!capturedUri) return;

    const page = PDFPage
      .create()
      .setMediaBox(612, 792) // 8.5 x 11 inches
      .drawImage(capturedUri, 'jpg', {
        x: 0,
        y: 0,
        width: 612,
        height: 792
      });

    const docsDir = FileSystem.documentDirectory;
    const pdfPath = `${docsDir}scanned_doc_${Date.now()}.pdf`;

    await PDFDocument
      .create(pdfPath)
      .addPages(page)
      .write()  // Returns a promise that resolves with the PDF's path

    Alert.alert('Success', `PDF saved to: ${pdfPath}`);
    setIsPreview(false);
  };

  if (hasPermission === null) {
    return <View />;
  }

  if (hasPermission === false) {
    return <View><Text>No access to camera</Text></View>;
  }

  return (
    <View style={styles.container}>
      {!isPreview ? (
        <Camera style={styles.camera} type={Camera.Constants.Type.back} ref={cameraRef}>
          <View style={styles.buttonContainer}>
            <Button title="Scan Document" onPress={takePicture} />
          </View>
        </Camera>
      ) : (
        <View style={styles.preview}>
          <Button title="Save as PDF" onPress={createPDF} />
          <Button title="Retake" onPress={() => setIsPreview(false)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  buttonContainer: {
    backgroundColor: 'transparent',
    alignSelf: 'center',
    marginBottom: 20,
  },
  preview: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
