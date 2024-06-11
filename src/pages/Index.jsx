import React, { useState, useEffect } from "react";
import { Container, VStack, HStack, Text, Button, Input, Box, Checkbox, IconButton, Progress, useToast } from "@chakra-ui/react";
import { FaFolder, FaFile, FaUpload, FaTrash, FaDownload, FaFolderPlus, FaQrcode } from "react-icons/fa";
import axios from "axios";

const Index = () => {
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [folderName, setFolderName] = useState("");
  const toast = useToast();

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath]);

  const fetchFiles = async (path) => {
    try {
      const response = await axios.get(`/files/${path}`);
      setFiles(response.data);
    } catch (error) {
      toast({
        title: "Error fetching files",
        description: error.response?.data || error.message,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleFileUpload = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      await axios.post("/upload", formData, {
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });
      setUploadProgress(0);
      fetchFiles(currentPath);
    } catch (error) {
      toast({
        title: "Error uploading file",
        description: error.response?.data || error.message,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleCreateFolder = async (event) => {
    event.preventDefault();
    try {
      await axios.post("/create_folder", { folder_name: folderName, current_path: currentPath });
      setFolderName("");
      fetchFiles(currentPath);
    } catch (error) {
      toast({
        title: "Error creating folder",
        description: error.response?.data || error.message,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleDelete = async (path) => {
    try {
      await axios.delete(`/delete/${path}`);
      fetchFiles(currentPath);
    } catch (error) {
      toast({
        title: "Error deleting file/folder",
        description: error.response?.data || error.message,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleDownload = (path, isDir) => {
    const url = isDir ? `/download_folder/${path}` : `/download/${path}`;
    window.location.href = url;
  };

  return (
    <Container centerContent maxW="container.md" py={4}>
      <VStack spacing={4} width="100%">
        <Text fontSize="2xl">File Explorer</Text>
        <form onSubmit={handleFileUpload} encType="multipart/form-data">
          <HStack spacing={2}>
            <Input type="file" name="files" multiple />
            <IconButton type="submit" icon={<FaUpload />} aria-label="Upload" />
          </HStack>
        </form>
        <form onSubmit={handleCreateFolder}>
          <HStack spacing={2}>
            <Input placeholder="New folder name" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
            <IconButton type="submit" icon={<FaFolderPlus />} aria-label="Create Folder" />
          </HStack>
        </form>
        {uploadProgress > 0 && <Progress value={uploadProgress} size="sm" width="100%" />}
        <VStack spacing={2} width="100%">
          {files.map((file) => (
            <HStack key={file.path} spacing={2} width="100%" justifyContent="space-between">
              <Checkbox />
              <Box as={file.is_dir ? FaFolder : FaFile} />
              <Text flex="1" onClick={() => file.is_dir && setCurrentPath(file.path)} cursor={file.is_dir ? "pointer" : "default"}>
                {file.name}
              </Text>
              <IconButton icon={<FaDownload />} aria-label="Download" onClick={() => handleDownload(file.path, file.is_dir)} />
              <IconButton icon={<FaTrash />} aria-label="Delete" onClick={() => handleDelete(file.path)} />
            </HStack>
          ))}
        </VStack>
        <Button leftIcon={<FaQrcode />} onClick={() => (window.location.href = "/scan")}>
          Scan QR Code
        </Button>
      </VStack>
    </Container>
  );
};

export default Index;
